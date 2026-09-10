import { describe, expect, it } from 'vitest';

import { demoNavItems, type DemoNavKey } from './navigationModel.ts';

describe('demo navigation model', () => {
  it('includes diff view in demo navigation', () => {
    expect(demoNavItems.some((item) => item.key === 'diff')).toBe(true);
  });

  it('includes exactly the editor and viewer demo entries in order', () => {
    expect(demoNavItems).toEqual([
      { key: 'editor', label: 'Editor Demo' },
      { key: 'viewer', label: 'Viewer Demo' },
      { key: 'diff', label: 'Diff viewer' },
    ]);
  });

  it('contains only valid nav keys', () => {
    const validKeys = new Set<DemoNavKey>(['editor', 'viewer', 'diff']);
    for (const item of demoNavItems) {
      expect(validKeys.has(item.key)).toBe(true);
    }
  });
});
