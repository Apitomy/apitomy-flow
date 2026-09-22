import { describe, it, expect } from 'vitest';
import { nodeFieldComparisons } from './workflowDiffFieldComparisons.ts';
import { type NodeDiffRecord } from '../diff/workflowDiffTypes.ts';

function nodeRecord(overrides: Partial<NodeDiffRecord>): NodeDiffRecord {
  return {
    id: 'n1',
    status: 'changed',
    changes: ['config'],
    baseNode: {
      id: 'n1',
      type: 'human-task',
      name: 'Node',
      config: {},
      position: { x: 0, y: 0 },
    },
    compareNode: {
      id: 'n1',
      type: 'human-task',
      name: 'Node',
      config: {},
      position: { x: 0, y: 0 },
    },
    ...overrides,
  };
}

describe('nodeFieldComparisons', () => {
  it('expands changed human-task description to a description row', () => {
    const record = nodeRecord({
      baseNode: {
        id: 'triage',
        type: 'human-task',
        name: 'Triage Assessment',
        config: { description: 'Old text', inputs: { A: 'context.a' }, outputs: [{ name: 'x' }] },
        position: { x: 1, y: 2 },
      },
      compareNode: {
        id: 'triage',
        type: 'human-task',
        name: 'Triage Assessment',
        config: { description: 'New text', inputs: { A: 'context.a' }, outputs: [{ name: 'x' }] },
        position: { x: 1, y: 2 },
      },
    });

    const comparisons = nodeFieldComparisons(record);
    expect(comparisons).toEqual([{ field: 'description', before: 'Old text', after: 'New text' }]);
  });

  it('expands action config into specific changed rows only', () => {
    const record = nodeRecord({
      baseNode: {
        id: 'a1',
        type: 'action',
        name: 'Action',
        config: { actionType: 'send-email', inputs: { to: 'context.to' }, outputs: [{ name: 'id' }] },
        position: { x: 1, y: 2 },
      },
      compareNode: {
        id: 'a1',
        type: 'action',
        name: 'Action',
        config: { actionType: 'http-request', inputs: { to: 'context.to' }, outputs: [{ name: 'id2' }] },
        position: { x: 1, y: 2 },
      },
    });

    const comparisons = nodeFieldComparisons(record);
    expect(comparisons.map((c) => c.field)).toEqual(['actionType', 'outputs']);
  });

  it('expands wait config duration', () => {
    const record = nodeRecord({
      baseNode: { id: 'w1', type: 'wait', name: 'Wait', config: { duration: 'PT5M' }, position: { x: 1, y: 2 } },
      compareNode: { id: 'w1', type: 'wait', name: 'Wait', config: { duration: 'PT10M' }, position: { x: 1, y: 2 } },
    });

    const comparisons = nodeFieldComparisons(record);
    expect(comparisons).toEqual([{ field: 'duration', before: 'PT5M', after: 'PT10M' }]);
  });

  it('uses config.<field> fallback for unknown changed keys', () => {
    const record = nodeRecord({
      baseNode: { id: 'e1', type: 'end', name: 'End', config: { foo: 'a' }, position: { x: 1, y: 2 } },
      compareNode: { id: 'e1', type: 'end', name: 'End', config: { foo: 'b' }, position: { x: 1, y: 2 } },
    });

    const comparisons = nodeFieldComparisons(record);
    expect(comparisons).toEqual([{ field: 'config.foo', before: 'a', after: 'b' }]);
  });

  it('expands start inputs changes to an inputs row', () => {
    const record = nodeRecord({
      baseNode: {
        id: 'start',
        type: 'start',
        name: 'Start',
        config: { inputs: [{ name: 'cveId', type: 'string', required: true }] },
        position: { x: 1, y: 2 },
      },
      compareNode: {
        id: 'start',
        type: 'start',
        name: 'Start',
        config: {
          inputs: [
            { name: 'cveId', type: 'string', required: true },
            { name: 'source', type: 'string', required: false },
          ],
        },
        position: { x: 1, y: 2 },
      },
    });

    const comparisons = nodeFieldComparisons(record);
    expect(comparisons).toEqual([
      {
        field: 'inputs',
        before: [{ name: 'cveId', type: 'string', required: true }],
        after: [
          { name: 'cveId', type: 'string', required: true },
          { name: 'source', type: 'string', required: false },
        ],
      },
    ]);
  });

  it('expands receive-event eventType and outputs changes', () => {
    const record = nodeRecord({
      baseNode: {
        id: 'recv',
        type: 'receive-event',
        name: 'Receive',
        config: {
          eventType: 'repo.merged',
          outputs: [{ contextKey: 'status', expression: 'event.status' }],
        },
        position: { x: 1, y: 2 },
      },
      compareNode: {
        id: 'recv',
        type: 'receive-event',
        name: 'Receive',
        config: {
          eventType: 'repo.closed',
          outputs: [{ contextKey: 'status', expression: 'event.status' }, { contextKey: 'id', expression: 'event.id' }],
        },
        position: { x: 1, y: 2 },
      },
    });

    const comparisons = nodeFieldComparisons(record);
    expect(comparisons.map((c) => c.field)).toEqual(['eventType', 'outputs']);
  });

  it('expands end outcome changes to an outcome row', () => {
    const record = nodeRecord({
      baseNode: {
        id: 'end',
        type: 'end',
        name: 'End',
        config: { outcome: 'approved' },
        position: { x: 1, y: 2 },
      },
      compareNode: {
        id: 'end',
        type: 'end',
        name: 'End',
        config: { outcome: 'rejected' },
        position: { x: 1, y: 2 },
      },
    });

    const comparisons = nodeFieldComparisons(record);
    expect(comparisons).toEqual([{ field: 'outcome', before: 'approved', after: 'rejected' }]);
  });
});
