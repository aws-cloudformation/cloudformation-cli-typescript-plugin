// eslint-disable-next-line
const replaceAllShim = require('string.prototype.replaceall');

/**
 * Wait for a specified amount of time.
 *
 * @param {number} seconds Seconds that we will wait
 */
export async function delay(seconds: number): Promise<void> {
    return new Promise((_) => setTimeout(() => _(), seconds * 1000));
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
) {
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
