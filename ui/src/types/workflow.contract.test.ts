import { describe, expect, it } from 'vitest';
import type { WorkflowNode, ActionOutputConfig, EventOutputMapping, JsonValue,
    StartConfig, EndConfig, ActionConfig, HumanTaskConfig, ReceiveEventConfig, WaitConfig } from '../index.ts';

describe('public typed workflow contract', () => {
    it('accepts positionless nodes and recursive JSON host extensions', () => {
        const output: ActionOutputConfig = { name: 'result', type: 'object' };
        const mapping: EventOutputMapping = { contextKey: 'result', expression: '${event.result}' };
        const extension: JsonValue = { nested: [null, true, 42, { host: 'value' }] };
        const node: WorkflowNode = { id: 'a', name: 'Action', type: 'action',
            config: { actionType: 'host', inputs: { literal: extension }, outputs: [output], 'x-host': extension } };
        expect(JSON.parse(JSON.stringify(node)).config['x-host']).toEqual(extension);
        expect(mapping.contextKey).toBe('result');
    });
});

// Compile-only consumer checks: losing discrimination or JSON restrictions makes these directives fail.
function checkContract(node: WorkflowNode) {
    const configs: [StartConfig, EndConfig, ActionConfig, HumanTaskConfig, ReceiveEventConfig, WaitConfig] = [
        { inputs: [{ name: 'id', required: null, type: null }] }, { 'x-host': null },
        { inputs: null, outputs: [{ name: 'result', required: null, contextKey: null }] },
        { outputs: [{ name: 'answer', label: null, widget: null, options: null, defaultValue: null }] },
        { match: null, outputs: [{ contextKey: null, expression: null }] }, { duration: null },
    ];
    void configs;
    if (node.type === 'start') {
        const names: string[] = (node.config.inputs ?? []).map(input => input.name);
        void names;
    }
    // @ts-expect-error Action inputs are a map, not start-node declarations.
    const wrongInputs: WorkflowNode = { id: 'a', name: '', type: 'action', position: { x: 0, y: 0 }, config: { inputs: [{ name: 'x' }] } };
    // @ts-expect-error Built-in duration must be a string.
    const wrongDuration: WorkflowNode = { id: 'w', name: '', type: 'wait', position: { x: 0, y: 0 }, config: { duration: 12 } };
    // @ts-expect-error Host config fields must be JSON, not functions.
    const wrongExtension: WorkflowNode = { id: 'e', name: '', type: 'end', position: { x: 0, y: 0 }, config: { host: () => 1 } };
    void [wrongInputs, wrongDuration, wrongExtension];
}
void checkContract;
