/** Compare JSON values recursively, ignoring object key order but preserving array order. */
export function jsonEqual(before: unknown, after: unknown): boolean {
    if (before === after) {
        return true;
    }
    if (before === null || after === null || typeof before !== 'object' || typeof after !== 'object') {
        return false;
    }
    if (Array.isArray(before) || Array.isArray(after)) {
        return Array.isArray(before) && Array.isArray(after)
            && before.length === after.length
            && before.every((value, index) => jsonEqual(value, after[index]));
    }

    const beforeObject = before as Record<string, unknown>;
    const afterObject = after as Record<string, unknown>;
    const keys = Object.keys(beforeObject);
    return keys.length === Object.keys(afterObject).length
        && keys.every((key) => Object.hasOwn(afterObject, key) && jsonEqual(beforeObject[key], afterObject[key]));
}
