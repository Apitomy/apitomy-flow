import { describe, it, expect } from 'vitest';
import { workflowDiffNodeClass } from './workflowDiffNodeClass.ts';

describe('workflowDiffNodeClass', () => {
  it('returns status class for non-selected node', () => {
    expect(workflowDiffNodeClass('changed')).toBe('flow-diff-node flow-diff-node--changed');
  });

  it('does not include a custom selected class', () => {
    expect(workflowDiffNodeClass('added')).toBe('flow-diff-node flow-diff-node--added');
  });

  it('falls back to unchanged status when missing', () => {
    expect(workflowDiffNodeClass(undefined)).toBe('flow-diff-node flow-diff-node--unchanged');
  });
});
