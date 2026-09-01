/**
 * Helpers for editing map-based inputs (a `Record<string, string>`) as an ordered array of
 * `{ key, value }` pairs.
 *
 * The workflow serialization stores these inputs as a plain object keyed by the input name, but a
 * map cannot represent an entry mid-rename (empty key) or two entries that momentarily share a key.
 * Editing against a `Record` therefore drops entries on empty-key or duplicate-key collisions. The
 * editor works against the pair array instead — where rows are identified by position, so collisions
 * can coexist — and converts to/from the map only at the serialization boundary.
 */

/** A single map entry while being edited. Rows are identified by array position, not by `key`. */
export interface KeyValuePair {
  key: string;
  value: string;
}

/**
 * Converts a map to an ordered array of `{ key, value }` pairs, preserving insertion order. A
 * `null`/`undefined` map yields an empty array.
 *
 * @param map the serialized map, or `undefined`/`null`
 * @return the entries as pairs, in insertion order
 */
export function mapToPairs(map: Record<string, string> | null | undefined): KeyValuePair[] {
  if (!map) {
    return [];
  }
  return Object.entries(map).map(([key, value]) => ({ key, value }));
}

/**
 * Converts an array of `{ key, value }` pairs back to a map. Duplicate keys are resolved last-wins,
 * matching the behavior of `Object.fromEntries` used at the serialization boundary.
 *
 * @param pairs the edited pairs
 * @return the pairs as a map keyed by `key`
 */
export function pairsToMap(pairs: KeyValuePair[]): Record<string, string> {
  const map: Record<string, string> = {};
  for (const pair of pairs) {
    map[pair.key] = pair.value;
  }
  return map;
}

/**
 * Finds the non-empty keys that appear more than once across the given pairs. Empty keys are ignored
 * because multiple empty-key rows are permitted (they are flagged separately by the editor).
 *
 * @param pairs the edited pairs
 * @return the set of colliding non-empty keys
 */
export function duplicateKeys(pairs: KeyValuePair[]): Set<string> {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const pair of pairs) {
    if (pair.key === '') {
      continue;
    }
    if (seen.has(pair.key)) {
      duplicates.add(pair.key);
    } else {
      seen.add(pair.key);
    }
  }
  return duplicates;
}

/**
 * Shallow key/value equality for two maps, treating `null`/`undefined` as an empty map. Used to
 * detect whether an incoming map reflects an external change (undo/redo, source-view edit) rather
 * than this editor's own last serialized output.
 *
 * @param a the first map, or `undefined`/`null`
 * @param b the second map, or `undefined`/`null`
 * @return `true` if both maps have the same keys and values
 */
export function mapsEqual(
  a: Record<string, string> | null | undefined,
  b: Record<string, string> | null | undefined,
): boolean {
  const left: Record<string, string> = a ?? {};
  const right: Record<string, string> = b ?? {};
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  if (leftKeys.length !== rightKeys.length) {
    return false;
  }
  return leftKeys.every((key) => Object.prototype.hasOwnProperty.call(right, key) && left[key] === right[key]);
}
