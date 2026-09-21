import { describe, it, expect } from 'vitest';
import { getNodeDefinition } from './nodeDefinition.ts';
import { type WorkflowNode } from '../types/workflow.ts';
import { parseWorkflow } from './workflowIo.ts';

function node(overrides: Partial<WorkflowNode>): WorkflowNode {
  return {
    id: 'n1',
    type: 'action',
    name: 'My Node',
    config: {},
    position: { x: 0, y: 0 },
    ...overrides,
  };
}

describe('getNodeDefinition', () => {
    it.each(['action', 'human-task'])('formats imported %s literals safely for the Viewer', type => {
        const result = parseWorkflow(JSON.stringify({
            id: 'w', name: 'Workflow',
            nodes: [
                { id: 's', type: 'start' },
                { id: 'a', type, config: { actionType: 'noop', inputs: {
                    special: { toString: null, nested: [1] }, object: { count: 3 },
                    array: [{ toString: null }, false], expression: 'context.value', empty: null,
                } } },
                { id: 'e', type: 'end' },
            ],
            edges: [{ id: 'sa', source: 's', target: 'a' }, { id: 'ae', source: 'a', target: 'e' }],
        }));
        expect(result.workflow).toBeDefined();
        const definition = getNodeDefinition(result.workflow!.nodes[1]);
        expect(definition.sections.find(section => section.label === 'Inputs')?.fields).toEqual([
            { label: 'special', value: '{"toString":null,"nested":[1]}' },
            { label: 'object', value: '{"count":3}' },
            { label: 'array', value: '[{"toString":null},false]' },
            { label: 'expression', value: 'context.value' },
            { label: 'empty', value: 'null' },
        ]);
    });

  it('includes the node id, type and name regardless of node type', () => {
    const def = getNodeDefinition(node({ id: 'abc', type: 'wait', name: 'Wait a bit' }));
    expect(def.id).toBe('abc');
    expect(def.type).toBe('wait');
    expect(def.name).toBe('Wait a bit');
  });

  it('builds an Inputs section from a start node\'s config.inputs array', () => {
    const def = getNodeDefinition(node({
      type: 'start',
      config: {
        inputs: [
          { name: 'orderId', type: 'string', required: true, description: 'The order id' },
          { name: 'notes', type: 'string', required: false },
        ],
      },
    }));

    const inputs = def.sections.find(s => s.label === 'Inputs');
    expect(inputs).toBeDefined();
    expect(inputs!.fields).toEqual([
      { label: 'orderId', badge: 'string', value: 'The order id' },
      { label: 'notes', badge: 'string?', value: undefined },
    ]);
  });

  it('builds an Outputs section from a human-task node\'s config.outputs array', () => {
    const def = getNodeDefinition(node({
      type: 'human-task',
      config: {
        outputs: [
          { name: 'approved', type: 'boolean', required: true, label: 'Approved?', description: 'Approve or reject' },
        ],
      },
    }));

    const outputs = def.sections.find(s => s.label === 'Outputs');
    expect(outputs).toBeDefined();
    expect(outputs!.fields).toEqual([
      { label: 'Approved?', badge: 'boolean', value: 'Approve or reject' },
    ]);
  });

  it('surfaces a human-task output\'s contextKey override alongside its description', () => {
    const def = getNodeDefinition(node({
      type: 'human-task',
      config: {
        outputs: [
          {
            name: 'approved', type: 'boolean', required: true, label: 'Approved?',
            description: 'Approve or reject', contextKey: 'managerApproved',
          },
        ],
      },
    }));

    const outputs = def.sections.find(s => s.label === 'Outputs');
    expect(outputs!.fields).toEqual([
      { label: 'Approved?', badge: 'boolean', value: 'Approve or reject — stored as context.managerApproved' },
    ]);
  });

  it('surfaces a human-task output\'s contextKey override when there is no description', () => {
    const def = getNodeDefinition(node({
      type: 'human-task',
      config: {
        outputs: [
          { name: 'approved', type: 'boolean', required: true, contextKey: 'managerApproved' },
        ],
      },
    }));

    const outputs = def.sections.find(s => s.label === 'Outputs');
    expect(outputs!.fields).toEqual([
      { label: 'approved', badge: 'boolean', value: 'stored as context.managerApproved' },
    ]);
  });

  it('exposes a human-task node\'s config.description as the definition description', () => {
    const def = getNodeDefinition(node({
      type: 'human-task',
      config: { description: 'Review the order before approving.' },
    }));

    expect(def.description).toBe('Review the order before approving.');
  });

  it('builds an Inputs section (as a field list, not JSON) from a human-task node\'s config.inputs map', () => {
    const def = getNodeDefinition(node({
      type: 'human-task',
      config: {
        inputs: { 'Credit score': 'context.creditScore', 'Order total': 'context.orderTotal' },
      },
    }));

    const inputs = def.sections.find(s => s.label === 'Inputs');
    expect(inputs).toBeDefined();
    expect(inputs!.fields).toEqual([
      { label: 'Credit score', value: 'context.creditScore', badge: undefined },
      { label: 'Order total', value: 'context.orderTotal', badge: undefined },
    ]);
  });

  it('orders a human-task node\'s Inputs section before its Outputs section', () => {
    const def = getNodeDefinition(node({
      type: 'human-task',
      config: {
        inputs: { 'Credit score': 'context.creditScore' },
        outputs: [{ name: 'approved', type: 'boolean', required: true }],
      },
    }));

    const labels = def.sections.map(s => s.label);
    expect(labels.indexOf('Inputs')).toBeLessThan(labels.indexOf('Outputs'));
  });

  it('excludes description and inputs from the generic Config fallback for human-task nodes', () => {
    const def = getNodeDefinition(node({
      type: 'human-task',
      config: {
        description: 'Some instructions',
        inputs: { a: 'context.a' },
      },
    }));

    expect(def.sections.find(s => s.label === 'Config')).toBeUndefined();
  });

  it('builds Config, Inputs and Outputs sections for an action node', () => {
    const def = getNodeDefinition(node({
      type: 'action',
      config: {
        actionType: 'send-email',
        inputs: { to: '{{context.email}}', subject: 'Hello' },
        outputs: [{ name: 'messageId', type: 'string', required: true }],
      },
    }));

    const config = def.sections.find(s => s.label === 'Config');
    expect(config!.fields).toEqual([
      { label: 'actionType', value: 'send-email', badge: undefined },
    ]);

    const inputs = def.sections.find(s => s.label === 'Inputs');
    expect(inputs!.fields).toEqual([
      { label: 'to', value: '{{context.email}}', badge: undefined },
      { label: 'subject', value: 'Hello', badge: undefined },
    ]);

    const outputs = def.sections.find(s => s.label === 'Outputs');
    expect(outputs!.fields).toEqual([
      { label: 'messageId', badge: 'string', value: undefined },
    ]);
  });

  it('surfaces an action output\'s contextKey override', () => {
    const def = getNodeDefinition(node({
      type: 'action',
      config: {
        actionType: 'send-email',
        outputs: [{ name: 'result', type: 'string', required: true, contextKey: 'orderResult' }],
      },
    }));

    const outputs = def.sections.find(s => s.label === 'Outputs');
    expect(outputs!.fields).toEqual([
      { label: 'result', badge: 'string', value: 'stored as context.orderResult' },
    ]);
  });

  it('builds an "Output mappings" section from a receive-event node\'s config.outputs array', () => {
    const def = getNodeDefinition(node({
      type: 'receive-event',
      config: {
        eventType: 'order.created',
        outputs: [{ contextKey: 'orderId', expression: 'event.payload.id' }],
      },
    }));

    const outputs = def.sections.find(s => s.label === 'Output mappings');
    expect(outputs).toBeDefined();
    expect(outputs!.fields).toEqual([
      { label: 'orderId', badge: undefined, value: 'event.payload.id' },
    ]);
  });

  it('omits the "Output mappings" section for a receive-event node with no outputs declared', () => {
    const def = getNodeDefinition(node({
      type: 'receive-event',
      config: { eventType: 'order.created' },
    }));

    expect(def.sections.find(s => s.label === 'Output mappings')).toBeUndefined();
  });

  it('excludes outputs from the generic Config fallback for receive-event nodes', () => {
    const def = getNodeDefinition(node({
      type: 'receive-event',
      config: {
        eventType: 'order.created',
        outputs: [{ contextKey: 'orderId', expression: 'event.payload.id' }],
      },
    }));

    const config = def.sections.find(s => s.label === 'Config');
    expect(config!.fields.some(f => f.label === 'outputs')).toBe(false);
  });

  it('does not throw and skips a null entry in a receive-event node\'s outputs array', () => {
    const def = getNodeDefinition(node({
      type: 'receive-event',
      config: {
        eventType: 'order.created',
        outputs: [null, { contextKey: 'orderId', expression: 'event.payload.id' }],
      },
    }));

    const outputs = def.sections.find(s => s.label === 'Output mappings');
    expect(outputs).toBeDefined();
    expect(outputs!.fields).toEqual([
      { label: 'orderId', badge: undefined, value: 'event.payload.id' },
    ]);
  });

  it('does not throw when a receive-event node\'s outputs config is not an array', () => {
    const def = getNodeDefinition(node({
      type: 'receive-event',
      config: { eventType: 'order.created', outputs: 'not-an-array' },
    }));

    expect(def.sections.find(s => s.label === 'Output mappings')).toBeUndefined();
  });

  it('falls back to a generic Config section for node types without a special-cased shape', () => {
    const def = getNodeDefinition(node({
      type: 'wait',
      config: { durationSeconds: 30 },
    }));

    const config = def.sections.find(s => s.label === 'Config');
    expect(config!.fields).toEqual([
      { label: 'durationSeconds', value: '30', badge: undefined },
    ]);
  });

  it('omits sections that would otherwise be empty', () => {
    const def = getNodeDefinition(node({ type: 'end', config: {} }));
    expect(def.sections).toEqual([]);
  });
});
