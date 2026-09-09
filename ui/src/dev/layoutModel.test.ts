import { describe, expect, it } from 'vitest';

import { getContentSectionConfig } from './layoutModel.ts';

describe('layout model', () => {
  it('uses filled content section without a PageBody wrapper', () => {
    expect(getContentSectionConfig()).toEqual({
      isFilled: true,
      hasBodyWrapper: false,
    });
  });
});
