import { describe, it, expect } from 'vitest';
import { mapToPairs, pairsToMap, duplicateKeys, nextPairId, type KeyValuePair } from './mapInputs.ts';

describe('mapToPairs', () => {
  it('converts a map to pairs preserving insertion order', () => {
    expect(mapToPairs({ a: '1', b: '2' }).map(({ key, value }) => ({ key, value }))).toEqual([
      { key: 'a', value: '1' },
      { key: 'b', value: '2' },
    ]);
  });

  it('assigns a unique, non-empty id to each pair', () => {
    const pairs = mapToPairs({ a: '1', b: '2', c: '3' });
    for (const pair of pairs) {
      expect(pair.id).toBeTruthy();
    }
    const ids = new Set(pairs.map((p) => p.id));
    expect(ids.size).toBe(pairs.length);
  });

  it('returns an empty array for null/undefined', () => {
    expect(mapToPairs(undefined)).toEqual([]);
    expect(mapToPairs(null)).toEqual([]);
  });
});

describe('nextPairId', () => {
  it('returns a fresh, unique id on each call', () => {
    const ids = new Set([nextPairId(), nextPairId(), nextPairId()]);
    expect(ids.size).toBe(3);
  });
});

describe('pairsToMap', () => {
  it('round-trips a collision-free map', () => {
    const map = { label: 'context.a', other: 'context.b' };
    expect(pairsToMap(mapToPairs(map))).toEqual(map);
  });

  it('resolves duplicate keys last-wins', () => {
    const pairs: KeyValuePair[] = [
      { id: 'p1', key: 'k', value: 'first' },
      { id: 'p2', key: 'k', value: 'second' },
    ];
    expect(pairsToMap(pairs)).toEqual({ k: 'second' });
  });

  it('collapses empty-key pairs (serialization boundary), but the pairs themselves are preserved', () => {
    const pairs: KeyValuePair[] = [
      { id: 'p1', key: '', value: 'a' },
      { id: 'p2', key: '', value: 'b' },
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
      { id: 'p1', key: 'a', value: '1' },
      { id: 'p2', key: 'b', value: '2' },
      { id: 'p3', key: 'a', value: '3' },
    ];
    expect(duplicateKeys(pairs)).toEqual(new Set(['a']));
  });

  it('ignores empty keys', () => {
    const pairs: KeyValuePair[] = [
      { id: 'p1', key: '', value: '1' },
      { id: 'p2', key: '', value: '2' },
    ];
    expect(duplicateKeys(pairs)).toEqual(new Set());
  });

  it('returns an empty set when there are no collisions', () => {
    const pairs: KeyValuePair[] = [
      { id: 'p1', key: 'a', value: '1' },
      { id: 'p2', key: 'b', value: '2' },
    ];
    expect(duplicateKeys(pairs)).toEqual(new Set());
  });
});
