import { Readable } from 'stream';

export class MockAWSError {
    code?: string;
    message?: string;
    retryable?: boolean;
    constructor(options: { code?: string; message?: string; retryable?: boolean }) {
        Object.assign(this, options);
    }
}

export async function readableToString(readable: Readable): Promise<string> {
    return await readable.reduce<string>((str: string, data: any) => {
        return `${str}${data.toString()}`;
    }, '');
}
