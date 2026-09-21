import { describe, it, expect } from 'vitest';
import { serializeWorkflow, parseWorkflow, workflowFileName } from './workflowIo.ts';
import { type Workflow } from '../types/workflow.ts';

function validWorkflow(): Workflow {
  return {
    id: 'demo',
    name: 'Demo',
    nodes: [
      { id: 'start', type: 'start', name: 'Start', config: { inputs: [] }, position: { x: 0, y: 0 } },
      { id: 'act', type: 'action', name: 'Act', config: { actionType: 'noop', inputs: {}, outputs: [] }, position: { x: 0, y: 100 } },
      { id: 'end', type: 'end', name: 'End', config: {}, position: { x: 0, y: 200 } },
    ],
    edges: [
      { id: 'e1', source: 'start', target: 'act', priority: 0, isDefault: false },
      { id: 'e2', source: 'act', target: 'end', priority: 0, isDefault: false },
    ],
  };
}

describe('serializeWorkflow', () => {
  it('pretty-prints and round-trips through parseWorkflow', () => {
    const wf = validWorkflow();
    const text = serializeWorkflow(wf);
    expect(text).toContain('\n  '); // 2-space indented
    const result = parseWorkflow(text);
    expect(result.error).toBeUndefined();
    expect(result.workflow).toEqual(wf);
  });
});

describe('parseWorkflow', () => {
  it('accepts a valid workflow with no error-severity problems', () => {
    const result = parseWorkflow(serializeWorkflow(validWorkflow()));
    expect(result.workflow).toBeDefined();
    expect(result.problems.some(p => p.severity === 'error')).toBe(false);
  });

  it('rejects malformed JSON with a fatal error', () => {
    const result = parseWorkflow('{ not json');
    expect(result.error).toBeDefined();
    expect(result.workflow).toBeUndefined();
  });

  it('rejects a non-object top level', () => {
    const result = parseWorkflow('[]');
    expect(result.error).toBeDefined();
    expect(result.workflow).toBeUndefined();
  });

  it('rejects a definition missing required structural fields', () => {
    const result = parseWorkflow(JSON.stringify({ id: 'x', name: 'y', nodes: [] }));
    expect(result.error).toBeDefined();
    expect(result.workflow).toBeUndefined();
  });

  it('withholds the workflow when validation reports errors, surfacing the problems', () => {
    // A start node with no end node and no outgoing edge yields error-severity problems.
    const broken = JSON.stringify({
      id: 'broken',
      name: 'Broken',
      nodes: [{ id: 'start', type: 'start', name: 'Start', config: {}, position: { x: 0, y: 0 } }],
      edges: [],
    });
    const result = parseWorkflow(broken);
    expect(result.workflow).toBeUndefined();
    expect(result.error).toBeUndefined();
    expect(result.problems.some(p => p.severity === 'error')).toBe(true);
  });

  it('rejects malformed-but-shaped input with a fatal error instead of throwing', () => {
    const malformed = JSON.stringify({
      id: 'broken',
      name: 'Broken',
      nodes: [null],
      edges: [],
    });

    const result = parseWorkflow(malformed);
    expect(result.error).toBeDefined();
    expect(result.workflow).toBeUndefined();
    expect(result.problems).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'INVALID_NODE', severity: 'error' }),
    ]));
  });

  it('normalizes missing config and reports the missing action type', () => {
    const malformed = JSON.stringify({
      id: 'broken',
      name: 'Broken',
      nodes: [
        { id: 'start', type: 'start', name: 'Start', config: { inputs: [] }, position: { x: 0, y: 0 } },
        { id: 'act', type: 'action', name: 'Act', position: { x: 0, y: 100 } },
        { id: 'end', type: 'end', name: 'End', config: {}, position: { x: 0, y: 200 } },
      ],
      edges: [
        { id: 'e1', source: 'start', target: 'act', priority: 0, isDefault: false },
        { id: 'e2', source: 'act', target: 'end', priority: 0, isDefault: false },
      ],
    });

    const result = parseWorkflow(malformed);
    expect(result.error).toBeUndefined();
    expect(result.workflow).toBeUndefined();
    expect(result.problems).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'MISSING_ACTION_TYPE', severity: 'error' }),
    ]));
  });
});

describe('workflowFileName', () => {
  it('slugifies the workflow id', () => {
    expect(workflowFileName({ id: 'CVE Triage!', name: 'x', nodes: [], edges: [] })).toBe('cve-triage');
  });

  it('falls back to a default when id and name are empty', () => {
    expect(workflowFileName({ id: '', name: '', nodes: [], edges: [] })).toBe('workflow');
  });
});
