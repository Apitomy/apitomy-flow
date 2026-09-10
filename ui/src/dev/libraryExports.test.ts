import { describe, it, expect, vi } from 'vitest';

vi.mock('../components/WorkflowEditor.tsx', () => ({
  WorkflowEditor: () => null,
}));

vi.mock('../components/WorkflowViewer.tsx', () => ({
  WorkflowViewer: () => null,
}));

vi.mock('../components/WorkflowDiffViewer.tsx', () => ({
  WorkflowDiffViewer: () => null,
}));

import * as library from '../index.ts';

describe('library exports', () => {
  it('exports WorkflowDiffViewer', () => {
    expect(library.WorkflowDiffViewer).toBeTypeOf('function');
  });
});
