import { describe, expect, it } from 'vitest';
import { parseWorkflow, serializeWorkflow } from './workflowIo.ts';
import { validateWorkflow } from '../validation/validateWorkflow.ts';
import { toReactFlowEdges, toReactFlowNodes, toWorkflow } from './conversion.ts';
import { type Workflow } from '../types/workflow.ts';

function definition() {
    return {
        id: 'test', name: 'Test',
        nodes: [
            { id: 's', type: 'start', name: 'Start', config: { inputs: [] } },
            { id: 'a', type: 'action', name: 'Action', config: { actionType: 'noop', inputs: {}, outputs: [] } },
            { id: 'e', type: 'end', name: 'End', config: {} },
        ],
        edges: [{ id: 'sa', source: 's', target: 'a' }, { id: 'ae', source: 'a', target: 'e' }],
    };
}

describe('workflow JSON boundary', () => {
    it.each([null, 3, true, 'workflow', [], {}, { id: 'x', name: 'X', nodes: {}, edges: [] },
        { id: 'x', name: 'X', nodes: [], edges: null }])('reports malformed roots as structured errors: %j', raw => {
        const result = parseWorkflow(JSON.stringify(raw));
        expect(result.workflow).toBeUndefined();
        expect(result.problems.some(problem => problem.severity === 'error')).toBe(true);
        expect(validateWorkflow(raw)).toEqual(result.problems);
    });

    it.each([NaN, Infinity, -Infinity])('rejects nonfinite coordinates from direct callers: %s', x => {
        const raw = definition();
        Object.assign(raw.nodes[0], { position: { x, y: 0 } });
        expect(validateWorkflow(raw)).toEqual(expect.arrayContaining([
            expect.objectContaining({ code: 'INVALID_NODE_POSITION', severity: 'error' }),
        ]));
    });

    it('preserves explicit positions and does not mutate input during validation', () => {
        const raw = definition();
        raw.nodes.forEach((node, i) => Object.assign(node, { position: { x: 10, y: i * 100, host: true } }));
        const text = JSON.stringify(raw);
        validateWorkflow(raw);
        expect(JSON.stringify(raw)).toBe(text);
        const result = parseWorkflow(text);
        expect(result.workflow?.nodes.map(node => node.position)).toEqual([
            { x: 10, y: 0, host: true }, { x: 10, y: 100, host: true }, { x: 10, y: 200, host: true },
        ]);
    });

    it.each(['action', 'human-task'])('preserves JSON literal inputs on %s nodes', type => {
        const raw = definition();
        Object.assign(raw.nodes[1], { type, config: {
            actionType: 'noop', description: 'Do it', outputs: [],
            inputs: { count: 3, zero: 0, enabled: false, data: { nested: [true, null, 1] }, list: [1, 2] },
        } });
        const result = parseWorkflow(JSON.stringify(raw));
        expect(result.error).toBeUndefined();
        expect(result.workflow?.nodes[1].config.inputs).toEqual({
            count: 3, zero: 0, enabled: false, data: { nested: [true, null, 1] }, list: [1, 2],
        });
        expect(result.problems).not.toEqual(expect.arrayContaining([
            expect.objectContaining({ code: type === 'action' ? 'EMPTY_ACTION_INPUT_EXPRESSION' : 'EMPTY_TASK_INPUT_EXPRESSION' }),
        ]));
    });

    const malformed: [string, (raw: ReturnType<typeof definition>) => void, string][] = [
        ['unknown kind', raw => Object.assign(raw.nodes[1], { type: 'unknown' }), 'INVALID_NODE_TYPE'],
        ['null node', raw => Object.assign(raw.nodes, { 1: null }), 'INVALID_NODE'],
        ['null edge', raw => Object.assign(raw.edges, { 0: null }), 'INVALID_EDGE'],
        ['missing endpoints', raw => raw.edges.push({ id: 'bad' } as never), 'MISSING_EDGE_SOURCE'],
        ['blank target', raw => raw.edges[0].target = ' ', 'MISSING_EDGE_TARGET'],
        ['numeric id', raw => Object.assign(raw.nodes[1], { id: 42 }), 'MISSING_NODE_ID'],
        ['object name', raw => Object.assign(raw.nodes[1], { name: {} }), 'INVALID_NODE_NAME'],
        ['array config', raw => Object.assign(raw.nodes[1], { config: [] }), 'INVALID_NODE_CONFIG'],
        ['array inputs', raw => raw.nodes[1].config.inputs = [], 'INVALID_INPUTS_TYPE'],
        ['object outputs', raw => Object.assign(raw.nodes[1].config, { outputs: {} }), 'INVALID_OUTPUTS_TYPE'],
        ['null output', raw => Object.assign(raw.nodes[1].config, { outputs: [null] }), 'INVALID_OUTPUT_DEFINITION'],
        ['object output name', raw => Object.assign(raw.nodes[1].config, { outputs: [{ name: {} }] }), 'INVALID_OUTPUT_DEFINITION'],
        ['string required', raw => Object.assign(raw.nodes[0].config, { inputs: [{ name: 'x', required: 'false' }] }), 'INVALID_INPUT_DEFINITION'],
        ['object start inputs', raw => Object.assign(raw.nodes[0].config, { inputs: {} }), 'INVALID_INPUTS_TYPE'],
        ['null start input', raw => Object.assign(raw.nodes[0].config, { inputs: [null] }), 'INVALID_INPUT_DEFINITION'],
        ['object match', raw => Object.assign(raw.nodes[1], { type: 'receive-event', config: { match: {} } }), 'INVALID_MATCH_TYPE'],
        ['null match entry', raw => Object.assign(raw.nodes[1], { type: 'receive-event', config: { match: [null] } }), 'INVALID_MATCH_TYPE'],
        ['numeric duration', raw => Object.assign(raw.nodes[1], { type: 'wait', config: { duration: 3 } }), 'INVALID_WAIT_DURATION'],
        ['object description', raw => Object.assign(raw.nodes[1], { type: 'human-task', config: { description: {} } }), 'INVALID_TASK_DESCRIPTION'],
        ['null option', raw => Object.assign(raw.nodes[1], { type: 'human-task', config: { outputs: [{ name: 'x', options: [null] }] } }), 'MALFORMED_OUTPUT_OPTION'],
        ['object option label', raw => Object.assign(raw.nodes[1], { type: 'human-task', config: { outputs: [{ name: 'x', options: [{ label: {}, value: 'x' }] }] } }), 'MALFORMED_OUTPUT_OPTION'],
        ['object options', raw => Object.assign(raw.nodes[1], { type: 'human-task', config: { outputs: [{ name: 'x', options: {} }] } }), 'INVALID_OUTPUT_DEFINITION'],
        ['object condition', raw => Object.assign(raw.edges[0], { condition: {} }), 'INVALID_EDGE_CONDITION'],
        ['string priority', raw => Object.assign(raw.edges[0], { priority: '1' }), 'INVALID_EDGE_PRIORITY'],
        ['string default', raw => Object.assign(raw.edges[0], { isDefault: 'false' }), 'INVALID_EDGE_DEFAULT'],
        ['object label', raw => Object.assign(raw.edges[0], { label: {} }), 'INVALID_EDGE_LABEL'],
        ['partial position', raw => Object.assign(raw.nodes[1], { position: { x: 1 } }), 'INVALID_NODE_POSITION'],
        ['string position', raw => Object.assign(raw.nodes[1], { position: 'origin' }), 'INVALID_NODE_POSITION'],
    ];

    it.each(malformed)('rejects %s before semantic analysis or rendering', (_, mutate, code) => {
        const raw = definition();
        mutate(raw);
        const result = parseWorkflow(JSON.stringify(raw));
        expect(result.workflow).toBeUndefined();
        expect(result.problems).toEqual(expect.arrayContaining([expect.objectContaining({ code, severity: 'error' })]));
        expect(() => validateWorkflow(raw as unknown as Workflow)).not.toThrow();
        expect(validateWorkflow(raw as unknown as Workflow)).toEqual(expect.arrayContaining([
            expect.objectContaining({ code, severity: 'error' }),
        ]));
    });

    it('normalizes optional defaults, lays out missing positions, and preserves extensions through editing', () => {
        const raw = definition();
        Object.assign(raw, { host: { theme: 'dark' } });
        Object.assign(raw.nodes[0], { hostNode: { key: 1 }, config: null, name: null });
        Object.assign(raw.nodes[1].config, { hostConfig: { items: [null, 1] } });
        Object.assign(raw.edges[0], { hostEdge: ['custom'] });
        const result = parseWorkflow(JSON.stringify(raw));
        expect(result.workflow).toBeDefined();
        const workflow = result.workflow!;
        expect(workflow.nodes[0].config).toEqual({});
        expect(workflow.nodes[0].name).toBe('');
        expect(workflow.edges[0]).toMatchObject({ priority: 0, isDefault: false });
        expect(new Set(workflow.nodes.map(node => `${node.position.x},${node.position.y}`)).size).toBe(3);
        const edited = toWorkflow(workflow, toReactFlowNodes(workflow.nodes), toReactFlowEdges(workflow.edges));
        expect(JSON.parse(serializeWorkflow(edited))).toMatchObject({
            host: { theme: 'dark' },
            nodes: [{ hostNode: { key: 1 } }, { config: { hostConfig: { items: [null, 1] } } }, {}],
            edges: [{ hostEdge: ['custom'] }, {}],
        });
    });
});
