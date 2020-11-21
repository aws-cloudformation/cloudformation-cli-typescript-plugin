import { AWSError } from 'aws-sdk';
import { Service } from 'aws-sdk/lib/service';
import path from 'path';
import Piscina from 'piscina';
import { deserializeError } from 'serialize-error';

import { Constructor, ServiceProperties } from '../interface';
import { ClientApiOptions, InferredResult, ServiceOperation } from './aws-sdk';

type PoolOptions = ConstructorParameters<typeof Piscina>[0];

class ThreadPool extends Piscina {
    #drained: boolean;
    #done: boolean;

    constructor(poolOptions?: PoolOptions) {
        super(poolOptions);
        this.restart();
        this.on('drain', () => {
            this.#drained = true;
        });
    }

    get done(): boolean {
        return this.#done;
    }

    get drained(): boolean {
        return this.#drained;
    }

    end(): void {
        this.#done = true;
    }

    begin(): void {
        this.#drained = false;
    }

    restart(): void {
        this.#drained = true;
        this.#done = false;
    }

    get isFinished(): boolean {
        return !this.queueSize && this.drained && this.done;
    }

    async shutdown(doDestroy = true): Promise<boolean> {
        this.end();
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

/**
 * Class to manage the pool of threads where we will have multiple workers
 * to interact with the AWS APIs by using its SDK.
 */
export class AwsSdkThreadPool extends ThreadPool {
    constructor(poolOptions?: PoolOptions) {
        super({
            filename: path.resolve(__dirname, '../../dist/workers/aws-sdk.js'),
            idleTimeout: 25000, // Little less than the minimum 30 seconds from lambda handlers
            ...poolOptions,
        });
    }

    async runAwsTask<
        S extends Service = Service,
        C extends Constructor<S> = Constructor<S>,
        O extends ServiceProperties<S, C> = ServiceProperties<S, C>,
        E extends Error = AWSError,
        N extends ServiceOperation<S, C, O, E> = ServiceOperation<S, C, O, E>
    >(params: ClientApiOptions<S, C, O, E, N>): Promise<InferredResult<S, C, O, E, N>> {
        if (this.done) {
            throw Error(
                'Not allowed to make an API call after the worker pool has been flagged as done.'
            );
        }
        this.begin();
        try {
            const taskInput = JSON.parse(JSON.stringify(params));
            const result = await this.runTask(taskInput);
            return result;
        } catch (err) {
            if (typeof err === 'string') {
                throw deserializeError(err);
            }
            this.emit('drain');
            throw err;
        }
    }
}
