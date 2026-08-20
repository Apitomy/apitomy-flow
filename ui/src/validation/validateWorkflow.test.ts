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

  // ========================================================================
  // New validation rules
  // ========================================================================

  describe('workflow identity', () => {
    it('MISSING_WORKFLOW_ID when id is empty', () => {
      const w: Workflow = { id: '', name: 'Test', nodes: [node('start', 'start'), node('end', 'end')], edges: [edge('e1', 'start', 'end')] };
      expect(hasProblem(validateWorkflow(w), 'MISSING_WORKFLOW_ID')).toBe(true);
    });

    it('MISSING_WORKFLOW_NAME when name is empty', () => {
      const w: Workflow = { id: 'test', name: '', nodes: [node('start', 'start'), node('end', 'end')], edges: [edge('e1', 'start', 'end')] };
      expect(hasProblem(validateWorkflow(w), 'MISSING_WORKFLOW_NAME')).toBe(true);
    });
  });

  describe('empty workflow', () => {
    it('EMPTY_WORKFLOW when no nodes', () => {
      const w = workflow([], []);
      const problems = validateWorkflow(w);
      expect(hasProblem(problems, 'EMPTY_WORKFLOW')).toBe(true);
      expect(hasProblem(problems, 'NO_START_NODE')).toBe(false);
      expect(hasProblem(problems, 'NO_END_NODE')).toBe(false);
    });
  });

  describe('node identity', () => {
    it('MISSING_NODE_ID when id is empty', () => {
      const w = workflow(
        [{ id: '', type: 'action' as const, name: 'A', config: { actionType: 'x' }, position: { x: 0, y: 0 } },
         node('start', 'start'), node('end', 'end')],
        [edge('e1', 'start', 'end')],
      );
      expect(hasProblem(validateWorkflow(w), 'MISSING_NODE_ID')).toBe(true);
    });

    it('MISSING_NODE_NAME when name is empty', () => {
      const w = workflow(
        [node('start', 'start'), { id: 'a', type: 'action' as const, name: '', config: { actionType: 'x' }, position: { x: 0, y: 0 } }, node('end', 'end')],
        [edge('e1', 'start', 'a'), edge('e2', 'a', 'end')],
      );
      expect(hasProblem(validateWorkflow(w), 'MISSING_NODE_NAME')).toBe(true);
    });
  });

  describe('edge identity', () => {
    it('MISSING_EDGE_ID when id is empty', () => {
      const w = workflow(
        [node('start', 'start'), node('end', 'end')],
        [{ id: '', source: 'start', target: 'end', priority: 0, isDefault: false }],
      );
      expect(hasProblem(validateWorkflow(w), 'MISSING_EDGE_ID')).toBe(true);
    });
  });

  describe('self-loop edge', () => {
    it('SELF_LOOP_EDGE when source equals target', () => {
      const w = workflow(
        [node('start', 'start'), node('a', 'action', { actionType: 'x' }), node('end', 'end')],
        [edge('e1', 'start', 'a'), edge('e2', 'a', 'a'), edge('e3', 'a', 'end')],
      );
      expect(hasProblem(validateWorkflow(w), 'SELF_LOOP_EDGE')).toBe(true);
    });
  });

  describe('duplicate edge', () => {
    it('DUPLICATE_EDGE when same source and target', () => {
      const w = workflow(
        [node('start', 'start'), node('end', 'end')],
        [edge('e1', 'start', 'end'), edge('e2', 'start', 'end')],
      );
      expect(hasProblem(validateWorkflow(w), 'DUPLICATE_EDGE')).toBe(true);
    });
  });

  describe('action type value', () => {
    it('INVALID_ACTION_TYPE_VALUE when actionType is a number', () => {
      const w = workflow(
        [node('start', 'start'), node('a', 'action', { actionType: 42 }), node('end', 'end')],
        [edge('e1', 'start', 'a'), edge('e2', 'a', 'end')],
      );
      expect(hasProblem(validateWorkflow(w), 'INVALID_ACTION_TYPE_VALUE')).toBe(true);
    });

    it('INVALID_ACTION_TYPE_VALUE when actionType is blank', () => {
      const w = workflow(
        [node('start', 'start'), node('a', 'action', { actionType: '  ' }), node('end', 'end')],
        [edge('e1', 'start', 'a'), edge('e2', 'a', 'end')],
      );
      expect(hasProblem(validateWorkflow(w), 'INVALID_ACTION_TYPE_VALUE')).toBe(true);
    });
  });

  describe('invalid inputs type', () => {
    it('INVALID_INPUTS_TYPE when inputs is a string', () => {
      const w = workflow(
        [node('start', 'start'), node('a', 'action', { actionType: 'test', inputs: 'not-a-map' }), node('end', 'end')],
        [edge('e1', 'start', 'a'), edge('e2', 'a', 'end')],
      );
      expect(hasProblem(validateWorkflow(w), 'INVALID_INPUTS_TYPE')).toBe(true);
    });

    it('INVALID_INPUTS_TYPE when inputs is an array', () => {
      const w = workflow(
        [node('start', 'start'), node('a', 'action', { actionType: 'test', inputs: ['a', 'b'] }), node('end', 'end')],
        [edge('e1', 'start', 'a'), edge('e2', 'a', 'end')],
      );
      expect(hasProblem(validateWorkflow(w), 'INVALID_INPUTS_TYPE')).toBe(true);
    });
  });

  describe('invalid outputs type', () => {
    it('INVALID_OUTPUTS_TYPE when outputs is a string', () => {
      const w = workflow(
        [node('start', 'start'), node('a', 'action', { actionType: 'test', outputs: 'not-a-list' }), node('end', 'end')],
        [edge('e1', 'start', 'a'), edge('e2', 'a', 'end')],
      );
      expect(hasProblem(validateWorkflow(w), 'INVALID_OUTPUTS_TYPE')).toBe(true);
    });
  });

  describe('default edge with condition', () => {
    it('DEFAULT_EDGE_WITH_CONDITION', () => {
      const w = workflow(
        [node('start', 'start'), node('end', 'end')],
        [edge('e1', 'start', 'end', { isDefault: true, condition: 'context.x == 1' })],
      );
      expect(hasProblem(validateWorkflow(w), 'DEFAULT_EDGE_WITH_CONDITION')).toBe(true);
    });
  });

  describe('single conditional edge', () => {
    it('SINGLE_CONDITIONAL_EDGE when only edge has condition', () => {
      const w = workflow(
        [node('start', 'start'), node('end', 'end')],
        [edge('e1', 'start', 'end', { condition: 'context.x == 1' })],
      );
      expect(hasProblem(validateWorkflow(w), 'SINGLE_CONDITIONAL_EDGE')).toBe(true);
    });

    it('no SINGLE_CONDITIONAL_EDGE when edge is unconditional', () => {
      const w = workflow(
        [node('start', 'start', { inputs: [{ name: 'x', type: 'string', required: true }] }), node('end', 'end')],
        [edge('e1', 'start', 'end')],
      );
      expect(hasProblem(validateWorkflow(w), 'SINGLE_CONDITIONAL_EDGE')).toBe(false);
    });
  });

  describe('invalid event type value', () => {
    it('INVALID_EVENT_TYPE_VALUE when eventType is a number', () => {
      const w = workflow(
        [node('start', 'start'), node('r', 'receive-event', { eventType: 42 }), node('end', 'end')],
        [edge('e1', 'start', 'r'), edge('e2', 'r', 'end')],
      );
      expect(hasProblem(validateWorkflow(w), 'INVALID_EVENT_TYPE_VALUE')).toBe(true);
    });

    it('INVALID_EVENT_TYPE_VALUE when eventType is blank', () => {
      const w = workflow(
        [node('start', 'start'), node('r', 'receive-event', { eventType: '  ' }), node('end', 'end')],
        [edge('e1', 'start', 'r'), edge('e2', 'r', 'end')],
      );
      expect(hasProblem(validateWorkflow(w), 'INVALID_EVENT_TYPE_VALUE')).toBe(true);
    });
  });

  describe('invalid wait duration', () => {
    it('INVALID_WAIT_DURATION when duration is not ISO 8601', () => {
      const w = workflow(
        [node('start', 'start'), node('w', 'wait', { duration: '30 minutes' }), node('end', 'end')],
        [edge('e1', 'start', 'w'), edge('e2', 'w', 'end')],
      );
      expect(hasProblem(validateWorkflow(w), 'INVALID_WAIT_DURATION')).toBe(true);
    });

    it('no INVALID_WAIT_DURATION for valid ISO 8601', () => {
      const w = workflow(
        [node('start', 'start', { inputs: [{ name: 'x', type: 'string', required: true }] }),
         node('w', 'wait', { duration: 'PT30M' }), node('end', 'end')],
        [edge('e1', 'start', 'w'), edge('e2', 'w', 'end')],
      );
      expect(hasProblem(validateWorkflow(w), 'INVALID_WAIT_DURATION')).toBe(false);
    });
  });

  describe('input definition validation', () => {
    it('INVALID_INPUT_DEFINITION when input has no name', () => {
      const w = workflow(
        [node('start', 'start', { inputs: [{ type: 'string', required: true }] }), node('end', 'end')],
        [edge('e1', 'start', 'end')],
      );
      expect(hasProblem(validateWorkflow(w), 'INVALID_INPUT_DEFINITION')).toBe(true);
    });

    it('INVALID_INPUT_DEFINITION when input name is blank', () => {
      const w = workflow(
        [node('start', 'start', { inputs: [{ name: '  ', type: 'string', required: true }] }), node('end', 'end')],
        [edge('e1', 'start', 'end')],
      );
      expect(hasProblem(validateWorkflow(w), 'INVALID_INPUT_DEFINITION')).toBe(true);
    });
  });

  describe('duplicate input name', () => {
    it('DUPLICATE_INPUT_NAME when start has duplicate inputs', () => {
      const w = workflow(
        [node('start', 'start', { inputs: [
          { name: 'x', type: 'string', required: true },
          { name: 'x', type: 'number', required: false },
        ] }), node('end', 'end')],
        [edge('e1', 'start', 'end')],
      );
      expect(hasProblem(validateWorkflow(w), 'DUPLICATE_INPUT_NAME')).toBe(true);
    });
  });

  describe('duplicate output name', () => {
    it('DUPLICATE_OUTPUT_NAME on action node', () => {
      const w = workflow(
        [
          node('start', 'start', { inputs: [{ name: 'x', type: 'string', required: true }] }),
          node('a', 'action', { actionType: 'test', outputs: [
            { name: 'result', type: 'string', required: true },
            { name: 'result', type: 'number', required: false },
          ] }),
          node('end', 'end'),
        ],
        [edge('e1', 'start', 'a'), edge('e2', 'a', 'end')],
      );
      expect(hasProblem(validateWorkflow(w), 'DUPLICATE_OUTPUT_NAME')).toBe(true);
    });

    it('DUPLICATE_OUTPUT_NAME on human task node', () => {
      const w = workflow(
        [
          node('start', 'start', { inputs: [{ name: 'x', type: 'string', required: true }] }),
          node('t', 'human-task', { description: 'Do it', outputs: [
            { name: 'decision', type: 'string', required: true },
            { name: 'decision', type: 'boolean', required: false },
          ] }),
          node('end', 'end'),
        ],
        [edge('e1', 'start', 't'), edge('e2', 't', 'end')],
      );
      expect(hasProblem(validateWorkflow(w), 'DUPLICATE_OUTPUT_NAME')).toBe(true);
    });
  });
});
