import { describe, it, expect } from 'vitest';
import { diffWorkflows, resolveWorkflowLabel } from './workflowDiff.ts';
import { type Workflow } from '../types/workflow.ts';

function wf(overrides: Partial<Workflow> = {}): Workflow {
  return {
    id: 'wf-1',
    name: 'Example Workflow',
    version: 1,
    nodes: [
      {
        id: 'start',
        type: 'start',
        name: 'Start',
        config: {},
        position: { x: 50, y: 50 },
      },
      {
        id: 'action-a',
        type: 'action',
        name: 'Action A',
        config: { actionType: 'send-email' },
        position: { x: 250, y: 50 },
      },
    ],
    edges: [
      {
        id: 'e1',
        source: 'start',
        target: 'action-a',
        condition: undefined,
        priority: 0,
        isDefault: true,
        label: 'default',
      },
    ],
    ...overrides,
  };
}

describe('diffWorkflows', () => {
  it('marks identical workflows as unchanged', () => {
    const base = wf();
    const compare = wf();
    const result = diffWorkflows(base, compare);

    expect(result.summary.nodes.unchanged).toBe(2);
    expect(result.summary.edges.unchanged).toBe(1);
    expect(result.warnings).toEqual([]);
  });

  it('marks position-only node edits as cosmetic', () => {
    const base = wf();
    const compare = wf({
      nodes: [
        base.nodes[0],
        { ...base.nodes[1], position: { x: 999, y: 777 } },
      ],
    });

    const result = diffWorkflows(base, compare);
    expect(result.nodes['action-a'].status).toBe('cosmetic');
    expect(result.nodes['action-a'].changes).toEqual(['position']);
  });

  it('marks node semantic changes as changed', () => {
    const base = wf();
    const compare = wf({
      nodes: [
        base.nodes[0],
        {
          ...base.nodes[1],
          name: 'Action A updated',
          config: { actionType: 'http-request' },
        },
      ],
    });

    const result = diffWorkflows(base, compare);
    expect(result.nodes['action-a'].status).toBe('changed');
    expect(result.nodes['action-a'].changes).toContain('name');
    expect(result.nodes['action-a'].changes).toContain('config');
  });

  it('marks added and removed nodes', () => {
    const base = wf();
    const compare = wf({
      nodes: [
        base.nodes[0],
        {
          id: 'action-b',
          type: 'action',
          name: 'Action B',
          config: { actionType: 'http-request' },
          position: { x: 450, y: 50 },
        },
      ],
      edges: [],
    });

    const result = diffWorkflows(base, compare);
    expect(result.nodes['action-a'].status).toBe('removed');
    expect(result.nodes['action-b'].status).toBe('added');
    expect(result.summary.nodes.removed).toBe(1);
    expect(result.summary.nodes.added).toBe(1);
  });

  it('marks priority-only edge edits as semantic changes', () => {
    const base = wf();
    const compare = wf({
      edges: [{ ...base.edges[0], priority: 42 }],
    });

    const result = diffWorkflows(base, compare);
    expect(result.edges.e1.status).toBe('changed');
    expect(result.edges.e1.changes).toEqual(['priority']);
  });

  it('marks added and removed edges', () => {
    const base = wf({
      edges: [
        {
          id: 'e-old',
          source: 'start',
          target: 'action-a',
          condition: undefined,
          priority: 0,
          isDefault: true,
          label: 'old',
        },
      ],
    });
    const compare = wf({
      edges: [
        {
          id: 'e-new',
          source: 'start',
          target: 'action-a',
          condition: undefined,
          priority: 0,
          isDefault: true,
          label: 'new',
        },
      ],
    });

    const result = diffWorkflows(base, compare);
    expect(result.edges['e-old'].status).toBe('removed');
    expect(result.edges['e-new'].status).toBe('added');
    expect(result.summary.edges.removed).toBe(1);
    expect(result.summary.edges.added).toBe(1);
  });

  it('marks source edge changes as semantic', () => {
    const base = wf();
    const compare = wf({
      edges: [{ ...base.edges[0], source: 'action-a' }],
    });

    const result = diffWorkflows(base, compare);
    expect(result.edges.e1.status).toBe('changed');
    expect(result.edges.e1.changes).toContain('source');
  });

  it('marks target edge changes as semantic', () => {
    const base = wf();
    const compare = wf({
      edges: [{ ...base.edges[0], target: 'start' }],
    });

    const result = diffWorkflows(base, compare);
    expect(result.edges.e1.status).toBe('changed');
    expect(result.edges.e1.changes).toContain('target');
  });

  it('marks condition edge changes as semantic', () => {
    const base = wf();
    const compare = wf({
      edges: [{ ...base.edges[0], condition: '${x > 10}' }],
    });

    const result = diffWorkflows(base, compare);
    expect(result.edges.e1.status).toBe('changed');
    expect(result.edges.e1.changes).toContain('condition');
  });

  it('marks isDefault edge changes as semantic', () => {
    const base = wf();
    const compare = wf({
      edges: [{ ...base.edges[0], isDefault: false }],
    });

    const result = diffWorkflows(base, compare);
    expect(result.edges.e1.status).toBe('changed');
    expect(result.edges.e1.changes).toContain('isDefault');
  });

  it('marks label edge changes as semantic', () => {
    const base = wf();
    const compare = wf({
      edges: [{ ...base.edges[0], label: 'fallback' }],
    });

    const result = diffWorkflows(base, compare);
    expect(result.edges.e1.status).toBe('changed');
    expect(result.edges.e1.changes).toContain('label');
  });

  it('ignores array ordering noise', () => {
    const base = wf();
    const compare = wf({
      nodes: [...base.nodes].reverse(),
      edges: [...base.edges].reverse(),
    });

    const result = diffWorkflows(base, compare);
    expect(result.summary.nodes.changed).toBe(0);
    expect(result.summary.nodes.cosmetic).toBe(0);
    expect(result.summary.edges.changed).toBe(0);
  });

  it('emits warnings for duplicate ids', () => {
    const base = wf({
      nodes: [
        {
          id: 'dup',
          type: 'start',
          name: 'A',
          config: {},
          position: { x: 0, y: 0 },
        },
        {
          id: 'dup',
          type: 'action',
          name: 'B',
          config: {},
          position: { x: 100, y: 0 },
        },
      ],
      edges: [],
    });

    const compare = wf({ nodes: [], edges: [] });
    const result = diffWorkflows(base, compare);

    expect(result.warnings.some((warning) => warning.code === 'DUPLICATE_NODE_ID')).toBe(true);
  });
});

describe('resolveWorkflowLabel', () => {
  it('formats name and version when present', () => {
    expect(resolveWorkflowLabel({ id: 'id-1', name: 'Flow', version: 7 })).toBe('Flow (v7)');
  });

  it('falls back to name then id', () => {
    expect(resolveWorkflowLabel({ id: 'id-2', name: 'Flow 2', version: undefined })).toBe('Flow 2');
    expect(resolveWorkflowLabel({ id: 'id-3', name: '', version: undefined })).toBe('id-3');
  });
});
