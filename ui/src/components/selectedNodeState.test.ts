import { describe, it, expect } from 'vitest';
import { isNodeSelected } from './selectedNodeState.ts';

describe('isNodeSelected', () => {
  it('returns true when node id matches selected node id', () => {
    expect(isNodeSelected('a', 'a')).toBe(true);
  });

  it('returns false when selected node id is null', () => {
    expect(isNodeSelected('a', null)).toBe(false);
  });

  it('returns false when node id differs from selected node id', () => {
    expect(isNodeSelected('a', 'b')).toBe(false);
  });
});
