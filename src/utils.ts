import { EventEmitter } from 'events';
// eslint-disable-next-line
const replaceAllShim = require('string.prototype.replaceall');

type PromiseFunction = () => Promise<any>;

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
 * Class to track progress of multiple asynchronous tasks,
 * so that we know when they are all finished.
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

    end(): void {
        this.#done = true;
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

    get completed(): number {
        return this.#tasksCompleted + this.#tasksFailed;
    }

    get isFinished(): boolean {
        return this.done && this.completed === this.#tasksSubmitted;
    }

    get message(): string {
        return (
            `${this.#tasksCompleted} of ${this.#tasksSubmitted} completed` +
            ` ${((this.#tasksCompleted / this.#tasksSubmitted) * 100).toFixed(2)}%` +
            ` [${this.#tasksFailed} failed]`
        );
    }

    async waitCompletion(): Promise<void> {
        return await new Promise((resolve) => {
            if (this.isFinished) {
                resolve();
            } else {
                this.once('finished', resolve);
            }
        });
    }
}

export class Queue {
    #queue: QueueItem[] = [];
    #pendingPromise = false;

    public enqueue(promise: PromiseFunction): Promise<any> {
        return new Promise((resolve, reject) => {
            this.#queue.push({
                promise,
                resolve,
                reject,
            });
            this.dequeue();
        });
    }

    private dequeue(): boolean {
        if (this.#pendingPromise) {
            return false;
        }
        const item = this.#queue.shift();
        if (!item) {
            return false;
        }
        try {
            this.#pendingPromise = true;
            item.promise()
                .then((value) => {
                    this.#pendingPromise = false;
                    item.resolve(value);
                    this.dequeue();
                })
                .catch((err) => {
                    this.#pendingPromise = false;
                    item.reject(err);
                    this.dequeue();
                });
        } catch (err) {
            this.#pendingPromise = false;
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
