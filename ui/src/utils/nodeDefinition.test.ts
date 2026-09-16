import { describe, it, expect } from 'vitest';
import { getNodeDefinition } from './nodeDefinition.ts';
import { type WorkflowNode } from '../types/workflow.ts';

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
