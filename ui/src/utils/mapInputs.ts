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

/**
 * A single map entry while being edited. Rows are identified by array position, not by `key`, so
 * empty-key and duplicate-key rows can coexist. The `id` is a stable per-row identity used only as
 * the React key when rendering, so rows reconcile by identity rather than position (keeping focus/IME
 * with the correct logical entry when a non-last row is removed or reordered).
 */
export interface KeyValuePair {
  id: string;
  key: string;
  value: string;
}

let pairIdCounter = 0;

/**
 * Mints a stable, unique id for a newly created {@link KeyValuePair}. Used both when converting from
 * a map and when appending a fresh row in the editor.
 *
 * @return a unique row id
 */
export function nextPairId(): string {
  return `pair-${pairIdCounter++}`;
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
  return Object.entries(map).map(([key, value]) => ({ id: nextPairId(), key, value }));
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
