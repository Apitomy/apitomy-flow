import { describe, it, expect } from 'vitest';
import { validateWorkflow } from './validateWorkflow.ts';
import { type Workflow, type WorkflowNode, type WorkflowEdge } from '../types/workflow.ts';

function node(id: string, type: WorkflowNode['type'], config: Record<string, any> = {}): WorkflowNode {
  return { id, type, name: id, config, position: { x: 0, y: 0 } };
}

function edge(id: string, source: string, target: string, opts: Partial<WorkflowEdge> = {}): WorkflowEdge {
  return { id, source, target, priority: 0, isDefault: false, ...opts };
}

function workflow(nodes: WorkflowNode[], edges: WorkflowEdge[]): Workflow {
  return { id: 'test', name: 'Test', nodes, edges };
}

function hasProblem(problems: ReturnType<typeof validateWorkflow>, code: string): boolean {
  return problems.some(p => p.code === code);
}

describe('validateWorkflow', () => {
  describe('structural rules', () => {
    it('NO_START_NODE when no start', () => {
      const w = workflow([node('end', 'end')], []);
      expect(hasProblem(validateWorkflow(w), 'NO_START_NODE')).toBe(true);
    });

    it('MULTIPLE_START_NODES', () => {
      const w = workflow(
        [node('s1', 'start'), node('s2', 'start'), node('end', 'end')],
        [edge('e1', 's1', 'end'), edge('e2', 's2', 'end')],
      );
      expect(hasProblem(validateWorkflow(w), 'MULTIPLE_START_NODES')).toBe(true);
    });

    it('NO_END_NODE', () => {
      const w = workflow([node('start', 'start')], []);
      expect(hasProblem(validateWorkflow(w), 'NO_END_NODE')).toBe(true);
    });

    it('INVALID_EDGE_SOURCE', () => {
      const w = workflow(
        [node('start', 'start'), node('end', 'end')],
        [edge('e1', 'missing', 'end')],
      );
      expect(hasProblem(validateWorkflow(w), 'INVALID_EDGE_SOURCE')).toBe(true);
    });

    it('INVALID_EDGE_TARGET', () => {
      const w = workflow(
        [node('start', 'start'), node('end', 'end')],
        [edge('e1', 'start', 'missing')],
      );
      expect(hasProblem(validateWorkflow(w), 'INVALID_EDGE_TARGET')).toBe(true);
    });

    it('DUPLICATE_NODE_ID', () => {
      const w = workflow([node('dup', 'start'), node('dup', 'end')], []);
      expect(hasProblem(validateWorkflow(w), 'DUPLICATE_NODE_ID')).toBe(true);
    });

    it('DUPLICATE_EDGE_ID', () => {
      const w = workflow(
        [node('start', 'start'), node('end', 'end')],
        [edge('dup', 'start', 'end'), edge('dup', 'start', 'end')],
      );
      expect(hasProblem(validateWorkflow(w), 'DUPLICATE_EDGE_ID')).toBe(true);
    });

    it('START_HAS_INCOMING', () => {
      const w = workflow(
        [node('start', 'start'), node('a', 'action', { actionType: 'x' }), node('end', 'end')],
        [edge('e1', 'start', 'a'), edge('e2', 'a', 'start'), edge('e3', 'a', 'end')],
      );
      expect(hasProblem(validateWorkflow(w), 'START_HAS_INCOMING')).toBe(true);
    });

    it('END_HAS_OUTGOING', () => {
      const w = workflow(
        [node('start', 'start'), node('end', 'end'), node('a', 'action', { actionType: 'x' })],
        [edge('e1', 'start', 'end'), edge('e2', 'end', 'a')],
      );
      expect(hasProblem(validateWorkflow(w), 'END_HAS_OUTGOING')).toBe(true);
    });

    it('MISSING_ACTION_TYPE', () => {
      const w = workflow(
        [node('start', 'start'), node('a', 'action'), node('end', 'end')],
        [edge('e1', 'start', 'a'), edge('e2', 'a', 'end')],
      );
      expect(hasProblem(validateWorkflow(w), 'MISSING_ACTION_TYPE')).toBe(true);
    });
  });

  describe('connectivity rules', () => {
    it('DISCONNECTED_NODE', () => {
      const w = workflow(
        [node('start', 'start'), node('end', 'end'), node('orphan', 'action', { actionType: 'x' })],
        [edge('e1', 'start', 'end')],
      );
      expect(hasProblem(validateWorkflow(w), 'DISCONNECTED_NODE')).toBe(true);
    });

    it('NO_OUTGOING_EDGES', () => {
      const w = workflow(
        [node('start', 'start'), node('a', 'action', { actionType: 'x' }), node('end', 'end')],
        [edge('e1', 'start', 'a')],
      );
      expect(hasProblem(validateWorkflow(w), 'NO_OUTGOING_EDGES')).toBe(true);
    });
  });

  describe('edge/condition rules', () => {
    it('NO_DEFAULT_EDGE with conditional edges', () => {
      const w = workflow(
        [node('start', 'start'), node('a', 'action', { actionType: 'x' }), node('b', 'action', { actionType: 'y' }), node('end', 'end')],
        [
          edge('e1', 'start', 'a', { condition: 'context.x == 1', priority: 1 }),
          edge('e2', 'start', 'b', { condition: 'context.x == 2', priority: 2 }),
          edge('e3', 'a', 'end'),
          edge('e4', 'b', 'end'),
        ],
      );
      expect(hasProblem(validateWorkflow(w), 'NO_DEFAULT_EDGE')).toBe(true);
    });

    it('MULTIPLE_DEFAULT_EDGES', () => {
      const w = workflow(
        [node('start', 'start'), node('end1', 'end'), node('end2', 'end')],
        [
          edge('e1', 'start', 'end1', { isDefault: true }),
          edge('e2', 'start', 'end2', { isDefault: true }),
        ],
      );
      expect(hasProblem(validateWorkflow(w), 'MULTIPLE_DEFAULT_EDGES')).toBe(true);
    });
  });

  describe('semantic rules', () => {
    it('MISSING_EVENT_TYPE', () => {
      const w = workflow(
        [node('start', 'start'), node('r', 'receive-event'), node('end', 'end')],
        [edge('e1', 'start', 'r'), edge('e2', 'r', 'end')],
      );
      expect(hasProblem(validateWorkflow(w), 'MISSING_EVENT_TYPE')).toBe(true);
    });

    it('MISSING_START_INPUTS', () => {
      const w = workflow(
        [node('start', 'start'), node('end', 'end')],
        [edge('e1', 'start', 'end')],
      );
      expect(hasProblem(validateWorkflow(w), 'MISSING_START_INPUTS')).toBe(true);
    });

    it('EMPTY_ACTION_INPUT_EXPRESSION when action input has empty expression', () => {
      const w = workflow(
        [
          node('start', 'start', { inputs: [{ name: 'x', type: 'string', required: true }] }),
          node('a', 'action', { actionType: 'test', inputs: { url: '', method: 'context.method' }, outputs: [] }),
          node('end', 'end'),
        ],
        [edge('e1', 'start', 'a'), edge('e2', 'a', 'end')],
      );
      const problems = validateWorkflow(w);
      expect(hasProblem(problems, 'EMPTY_ACTION_INPUT_EXPRESSION')).toBe(true);
      expect(problems.filter(p => p.code === 'EMPTY_ACTION_INPUT_EXPRESSION')).toHaveLength(1);
    });

    it('no EMPTY_ACTION_INPUT_EXPRESSION when all expressions filled', () => {
      const w = workflow(
        [
          node('start', 'start', { inputs: [{ name: 'x', type: 'string', required: true }] }),
          node('a', 'action', { actionType: 'test', inputs: { url: 'context.url', method: 'context.method' }, outputs: [] }),
          node('end', 'end'),
        ],
        [edge('e1', 'start', 'a'), edge('e2', 'a', 'end')],
      );
      expect(hasProblem(validateWorkflow(w), 'EMPTY_ACTION_INPUT_EXPRESSION')).toBe(false);
    });

    it('EMPTY_TASK_INPUT_EXPRESSION when human task input has empty expression', () => {
      const w = workflow(
        [
          node('start', 'start', { inputs: [{ name: 'x', type: 'string', required: true }] }),
          node('t', 'human-task', { description: 'Do it', inputs: { score: '' }, outputs: [{ name: 'decision', type: 'string', required: true }] }),
          node('end', 'end'),
        ],
        [edge('e1', 'start', 't'), edge('e2', 't', 'end')],
      );
      expect(hasProblem(validateWorkflow(w), 'EMPTY_TASK_INPUT_EXPRESSION')).toBe(true);
    });

    it('no EMPTY_TASK_INPUT_EXPRESSION when all expressions filled', () => {
      const w = workflow(
        [
          node('start', 'start', { inputs: [{ name: 'x', type: 'string', required: true }] }),
          node('t', 'human-task', { description: 'Do it', inputs: { score: 'context.score' }, outputs: [{ name: 'decision', type: 'string', required: true }] }),
          node('end', 'end'),
        ],
        [edge('e1', 'start', 't'), edge('e2', 't', 'end')],
      );
      expect(hasProblem(validateWorkflow(w), 'EMPTY_TASK_INPUT_EXPRESSION')).toBe(false);
    });
  });

  describe('valid workflows', () => {
    it('valid workflow has no errors', () => {
      const w = workflow(
        [
          node('start', 'start', { inputs: [{ name: 'x', type: 'string', required: true }] }),
          node('a', 'action', { actionType: 'test' }),
          node('end', 'end'),
        ],
        [edge('e1', 'start', 'a'), edge('e2', 'a', 'end')],
      );
      const errors = validateWorkflow(w).filter(p => p.severity === 'error');
      expect(errors).toHaveLength(0);
    });
  });
});
