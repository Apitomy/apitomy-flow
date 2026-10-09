/**
 * Serializes a JSON-compatible value using RFC 8785 (JSON Canonicalization Scheme).
 *
 * Object keys are sorted by UTF-16 code units (the default `Array.prototype.sort` order), properties whose
 * value is `undefined` are omitted, and numbers/strings use ECMAScript `JSON.stringify` formatting, which is
 * what RFC 8785 mandates.
 *
 * @param value the JSON value to serialize
 * @returns the canonical JSON text
 * @throws TypeError for non-finite numbers or non-JSON values
 */
export function canonicalJson(value: unknown): string {
    if (value === null) return 'null';
    switch (typeof value) {
        case 'boolean':
            return value ? 'true' : 'false';
        case 'number':
            if (!Number.isFinite(value)) throw new TypeError(`Non-finite number ${value} cannot be canonicalized`);
            return JSON.stringify(value);
        case 'string':
            return JSON.stringify(value);
        case 'object': {
            if (Array.isArray(value)) {
                return `[${value.map(item => (item === undefined ? 'null' : canonicalJson(item))).join(',')}]`;
            }
            const record = value as Record<string, unknown>;
            const keys = Object.keys(record).filter(key => record[key] !== undefined).sort();
            return `{${keys.map(key => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`;
        }
        default:
            throw new TypeError(`Unsupported JSON value of type ${typeof value}`);
    }
}
