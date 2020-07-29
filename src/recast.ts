import { InvalidRequest } from './exceptions';

type primitive = string | number | boolean | bigint | object;
type PrimitiveConstructor =
    | StringConstructor
    | NumberConstructor
    | BooleanConstructor
    | BigIntConstructor
    | ObjectConstructor;
const LOGGER = console;

/**
 * CloudFormation recasts all primitive types as strings, this tries to set them back to
 * the types defined in the model class
 */
export const recastPrimitive = (
    cls: PrimitiveConstructor,
    k: string,
    v: string
): primitive => {
    if (Object.is(cls, Object)) {
        // If the type is plain object, we cannot guess what the original type was, so we leave
        // it as a string
        return v;
    }
    if (Object.is(cls, Boolean)) {
        if (v.toLowerCase() === 'true') {
            return true;
        }
        if (v.toLowerCase() === 'false') {
            return false;
        }
        throw new InvalidRequest(`Value for ${k} "${v}" is not boolean`);
    }
    return cls(v).valueOf();
};

export const transformValue = (
    cls: any,
    key: string,
    value: any,
    obj: any,
    classes: any[] = [],
    index = 0
): primitive => {
    if (value == null) {
        return value;
    }
    classes.push(cls);
    const currentClass = classes[index || 0];
    if (value instanceof Map || Object.is(currentClass, Map)) {
        const temp = new Map(value instanceof Map ? value : Object.entries(value));
        temp.forEach((item: any, itemKey: string) => {
            temp.set(itemKey, transformValue(cls, key, item, obj, classes, index + 1));
        });
        return new Map(temp);
    } else if (value instanceof Set || Object.is(currentClass, Set)) {
        const temp = Array.from(value).map((item: any) => {
            return transformValue(cls, key, item, obj, classes, index + 1);
        });
        return new Set(temp);
    } else if (Array.isArray(value) || Array.isArray(currentClass)) {
        return value.map((item: any) => {
            return transformValue(cls, key, item, obj, classes, index + 1);
        });
    } else {
        // if type is plain object, we leave it as is
        if (Object.is(cls, Object)) {
            return value;
        }
        if (
            Object.is(cls, String) ||
            Object.is(cls, Number) ||
            Object.is(cls, Boolean) ||
            Object.is(cls, BigInt)
        ) {
            if (typeof value === 'string') {
                return recastPrimitive(cls, key, value);
            }
            return value;
        } else {
            throw new InvalidRequest(`Unsupported type: ${typeof value} for ${key}`);
        }
    }
};
