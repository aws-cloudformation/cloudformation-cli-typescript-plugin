import { AWSError } from 'aws-sdk';
import { Service, ServiceConfigurationOptions } from 'aws-sdk/lib/service';
import { EventEmitter } from 'events';
import path from 'path';
import Piscina from 'piscina';
import { deserializeError } from 'serialize-error';
// eslint-disable-next-line
const replaceAllShim = require('string.prototype.replaceall');

import { Constructor, OverloadedArguments, ServiceProperties } from './interface';
import { ClientApiOptions, InferredResult, ServiceOperation } from './workers/aws-sdk';

type PromiseFunction = () => Promise<any>;

type PoolOptions = ConstructorParameters<typeof Piscina>[0];

/**
 * Promise final result Type from a AWS Service Function
 *
 * @param S Type of the AWS Service
 * @param C Type of the constructor function of the AWS Service
 * @param O Names of the operations (method) within the service
 * @param E Type of the error thrown by the service function
 * @param N Type of the service function inferred by the given operation name
 */
export type ExtendedClient<S extends Service = Service> = S & {
    serviceIdentifier?: string;
} & Partial<
        Readonly<
            Record<
                'makeRequestPromise',
                <
                    C extends Constructor<S> = Constructor<S>,
                    O extends ServiceProperties<S, C> = ServiceProperties<S, C>,
                    E extends Error = AWSError,
                    N extends ServiceOperation<S, C, O, E> = ServiceOperation<
                        S,
                        C,
                        O,
                        E
                    >
                >(
                    operation: O,
                    input: OverloadedArguments<N>,
                    headers?: { [key: string]: string }
                ) => Promise<InferredResult<S, C, O, E, N>>
            >
        >
    >;

interface QueueItem {
    promise: PromiseFunction;
    reject: (value: any) => void;
    resolve: (reason: any) => void;
}

/**
 * Wait for a specified amount of time.
 *
 * @param {number} seconds Seconds that we will wait
 */
export async function delay(seconds: number): Promise<void> {
    return new Promise((_) => setTimeout(() => _(), seconds * 1000));
}

/**
 * Class to track progress of worker threads,
 * so that we know when it is finished.
 */
export class Progress extends EventEmitter {
    #tasksSubmitted: number;
    #tasksCompleted: number;
    #tasksFailed: number;
    #done: boolean;

    constructor() {
        super();
        this.restart();
        this.on('include', (kind: string) => {
            // console.debug(`Progress type being included [${kind}]`, this.message);
            if (kind !== 'submitted' && this.isFinished) {
                process.nextTick(() => this.emit('finished'));
            }
        });
    }

    get done(): boolean {
        return this.#done;
    }

    set done(value: boolean) {
        this.#done = value;
    }

    restart(): void {
        this.#tasksSubmitted = 0;
        this.#tasksCompleted = 0;
        this.#tasksFailed = 0;
        this.#done = false;
    }

    addSubmitted(): void {
        if (this.isFinished) {
            throw Error('Not allowed to submit a new task after it has been finished.');
        }
        this.#tasksSubmitted++;
        process.nextTick(() => this.emit('include', 'submitted'));
    }

    addCompleted(): void {
        this.#tasksCompleted++;
        process.nextTick(() => this.emit('include', 'completed'));
    }

    addFailed(): void {
        this.#tasksFailed++;
        process.nextTick(() => this.emit('include', 'failed'));
    }

    get isFinished(): boolean {
        return this.done && this.completed === this.#tasksSubmitted;
    }

    async waitToFinish(): Promise<void> {
        return await new Promise((resolve) => {
            if (this.isFinished) {
                resolve();
            } else {
                this.once('finished', resolve);
            }
        });
    }

    get completed(): number {
        return this.#tasksCompleted + this.#tasksFailed;
    }

    get message(): string {
        return (
            `${this.#tasksCompleted} of ${this.#tasksSubmitted} completed` +
            ` ${((this.#tasksCompleted / this.#tasksSubmitted) * 100).toFixed(2)}%` +
            ` [${this.#tasksFailed} failed]`
        );
    }
}

/**
 * Class to manage the pool of threads where we will have multiple workers
 * to interact with the AWS APIs by using its SDK.
 */
export class AwsSdkThreadPool extends Piscina {
    #drained: boolean;
    #done: boolean;

    constructor(poolOptions?: PoolOptions) {
        super({
            filename: path.resolve(__dirname, '../dist/workers/aws-sdk.js'),
            idleTimeout: 25000, // Little less than the minimum 30 seconds from lambda handlers
            ...poolOptions,
        });
        this.restart();
        this.on('drain', () => {
            this.#drained = true;
        });
    }

    done(): void {
        this.#done = true;
    }

    updateProgress(): void {
        this.#drained = false;
    }

    restart(): void {
        this.#drained = true;
        this.#done = false;
    }

    get isFinished(): boolean {
        return !this.queueSize && this.#drained && this.#done; //&& this.progress.isFinished;
    }

    client<
        S extends Service = Service,
        C extends Constructor<S> = Constructor<S>,
        O extends ServiceProperties<S, C> = ServiceProperties<S, C>,
        E extends Error = AWSError,
        N extends ServiceOperation<S, C, O, E> = ServiceOperation<S, C, O, E>
    >(service: S, options?: ServiceConfigurationOptions): ExtendedClient<S> {
        const client: ExtendedClient<S> = service;
        Object.defineProperty(client, 'makeRequestPromise', {
            value: async (
                operation: O,
                input: OverloadedArguments<N>,
                headers?: { [key: string]: string }
            ): Promise<InferredResult<S, C, O, E, N>> => {
                return await this.makeRequest<S, C, O, E, N>({
                    name: client.serviceIdentifier,
                    options: { ...client.config, options },
                    operation,
                    input,
                    headers,
                });
            },
        });
        return client;
    }

    async makeRequest<
        S extends Service = Service,
        C extends Constructor<S> = Constructor<S>,
        O extends ServiceProperties<S, C> = ServiceProperties<S, C>,
        E extends Error = AWSError,
        N extends ServiceOperation<S, C, O, E> = ServiceOperation<S, C, O, E>
    >(params: ClientApiOptions<S, C, O, E, N>): Promise<InferredResult<S, C, O, E, N>> {
        if (this.#done) {
            throw Error(
                'Not allowed to make an API call after the worker pool has been flagged as Done.'
            );
        }
        this.updateProgress();
        try {
            const taskInput = JSON.parse(JSON.stringify(params));
            const result = await this.runTask(taskInput);
            return result;
        } catch (err) {
            if (typeof err === 'string') {
                throw deserializeError(err);
            }
            throw err;
        }
    }

    async shutdown(doDestroy = true): Promise<boolean> {
        this.done();
        await new Promise((resolve, reject) => {
            if (this.isFinished) {
                resolve(null);
            } else {
                this.once('error', reject);
                this.once('drain', resolve);
            }
        });
        if (doDestroy) {
            await this.destroy();
        }
        return true;
    }
}

export class Queue {
    private queue: QueueItem[] = [];
    private pendingPromise = false;

    public enqueue(promise: PromiseFunction): Promise<any> {
        return new Promise((resolve, reject) => {
            this.queue.push({
                promise,
                resolve,
                reject,
            });
            this.dequeue();
        });
    }

    private dequeue(): boolean {
        if (this.pendingPromise) {
            return false;
        }
        const item = this.queue.shift();
        if (!item) {
            return false;
        }
        try {
            this.pendingPromise = true;
            item.promise()
                .then((value) => {
                    this.pendingPromise = false;
                    item.resolve(value);
                    this.dequeue();
                })
                .catch((err) => {
                    this.pendingPromise = false;
                    item.reject(err);
                    this.dequeue();
                });
        } catch (err) {
            this.pendingPromise = false;
            item.reject(err);
            this.dequeue();
        }
        return true;
    }
}

/**
 * Replaces all matched values in a string.
 *
 * @param original The original string where the replacement will take place.
 * @param substr A literal string that is to be replaced by newSubstr.
 * @param newSubstr The string that replaces the substring specified by the specified substr parameter.
 * @returns A new string, with all matches of a pattern replaced by a replacement.
 */
export function replaceAll(
    original: string,
    substr: string,
    newSubstr: string
): string {
    if (original) {
        return replaceAllShim(original, substr, newSubstr);
    }
    return original;
}

/**
 * Recursively apply provided operation on object and all of the object properties that are either object or function.
 *
 * @param obj The object to freeze
 * @returns Initial object with frozen properties applied on it
 */
export function deepFreeze(
    obj: Record<string, any> | Array<any> | Function,
    processed = new Set()
): Record<string, any> {
    if (
        // Prevent circular reference
        processed.has(obj) ||
        // Prevent not supported types
        !obj ||
        obj === Function.prototype ||
        !(typeof obj === 'object' || typeof obj === 'function' || Array.isArray(obj)) ||
        // Prevent issue with freezing buffers
        ArrayBuffer.isView(obj)
    ) {
        return obj;
    }

    processed.add(obj);

    // Retrieve the property names defined on object
    let propNames: Array<string | symbol | number> = Object.getOwnPropertyNames(obj);

    if (Object.getOwnPropertySymbols) {
        propNames = propNames.concat(Object.getOwnPropertySymbols(obj));
    }

    // Freeze properties before freezing self
    for (const name of propNames) {
        const value = obj[name as any];

        deepFreeze(value, processed);
    }

    return Object.isFrozen(obj) ? obj : Object.freeze(obj);
}
