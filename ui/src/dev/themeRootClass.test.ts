import { describe, expect, it } from 'vitest';

import { syncPatternFlyRootTheme } from './themeRootClass.ts';

describe('syncPatternFlyRootTheme', () => {
  it('applies the PatternFly dark class when theme is dark', () => {
    const calls: Array<{ token: string; force?: boolean }> = [];
    const classList = {
      toggle: (token: string, force?: boolean) => {
        calls.push({ token, force });
        return Boolean(force);
      },
    };

    syncPatternFlyRootTheme('dark', classList);

    expect(calls).toEqual([{ token: 'pf-v6-theme-dark', force: true }]);
  });

  it('removes the PatternFly dark class when theme is light', () => {
    const calls: Array<{ token: string; force?: boolean }> = [];
    const classList = {
      toggle: (token: string, force?: boolean) => {
        calls.push({ token, force });
        return Boolean(force);
      },
    };

    syncPatternFlyRootTheme('light', classList);

    expect(calls).toEqual([{ token: 'pf-v6-theme-dark', force: false }]);
  });
});
