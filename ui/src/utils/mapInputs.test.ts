import { describe, it, expect } from 'vitest';
import { mapToPairs, pairsToMap, duplicateKeys, type KeyValuePair } from './mapInputs.ts';

describe('mapToPairs', () => {
  it('converts a map to pairs preserving insertion order', () => {
    expect(mapToPairs({ a: '1', b: '2' })).toEqual([
      { key: 'a', value: '1' },
      { key: 'b', value: '2' },
    ]);
  });

  it('returns an empty array for null/undefined', () => {
    expect(mapToPairs(undefined)).toEqual([]);
    expect(mapToPairs(null)).toEqual([]);
  });
});

describe('pairsToMap', () => {
  it('round-trips a collision-free map', () => {
    const map = { label: 'context.a', other: 'context.b' };
    expect(pairsToMap(mapToPairs(map))).toEqual(map);
  });

  it('resolves duplicate keys last-wins', () => {
    const pairs: KeyValuePair[] = [
      { key: 'k', value: 'first' },
      { key: 'k', value: 'second' },
    ];
    expect(pairsToMap(pairs)).toEqual({ k: 'second' });
  });

  it('collapses empty-key pairs (serialization boundary), but the pairs themselves are preserved', () => {
    const pairs: KeyValuePair[] = [
      { key: '', value: 'a' },
      { key: '', value: 'b' },
    ];
    // Both rows coexist in the editor's pair array...
    expect(pairs).toHaveLength(2);
    // ...even though the map can only hold one empty key.
    expect(pairsToMap(pairs)).toEqual({ '': 'b' });
  });
});

describe('duplicateKeys', () => {
  it('detects non-empty keys that appear more than once', () => {
    const pairs: KeyValuePair[] = [
      { key: 'a', value: '1' },
      { key: 'b', value: '2' },
      { key: 'a', value: '3' },
    ];
    expect(duplicateKeys(pairs)).toEqual(new Set(['a']));
  });

  it('ignores empty keys', () => {
    const pairs: KeyValuePair[] = [
      { key: '', value: '1' },
      { key: '', value: '2' },
    ];
    expect(duplicateKeys(pairs)).toEqual(new Set());
  });

  it('returns an empty set when there are no collisions', () => {
    const pairs: KeyValuePair[] = [
      { key: 'a', value: '1' },
      { key: 'b', value: '2' },
    ];
    expect(duplicateKeys(pairs)).toEqual(new Set());
  });
});
