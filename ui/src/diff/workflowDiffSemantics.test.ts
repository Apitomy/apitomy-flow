import { describe, expect, it } from 'vitest';
import { nodeFieldComparisons } from '../components/workflowDiffFieldComparisons.ts';
import { type Workflow, type WorkflowNode } from '../types/workflow.ts';
import { diffWorkflows } from './workflowDiff.ts';

function workflow(config: WorkflowNode['config'], position: unknown = { x: 0, y: 0 }): Workflow {
    return {
        id: 'workflow',
        name: 'Workflow',
        nodes: [{ id: 'action', type: 'action', name: 'Action', config, position } as WorkflowNode],
        edges: [],
    };
}

function clearedHumanTaskWorkflow(): Workflow {
    return {
        id: 'workflow',
        name: 'Workflow',
        nodes: [{
            id: 'review',
            type: 'human-task',
            name: 'Review',
            config: {
                assignee: undefined,
                description: 'Review the decision',
                // The editor retains these optional keys after their fields are cleared.
                outputs: [{ name: 'decision', type: 'string', label: undefined, description: undefined }],
            },
            position: { x: 0, y: 0 },
        }],
        edges: [],
    };
}

describe('semantic workflow diffs', () => {
    it.each(['base', 'compare'])('ignores cleared optional object properties on the %s side', (side) => {
        const edited = clearedHumanTaskWorkflow();
        const persisted: Workflow = JSON.parse(JSON.stringify(edited));
        const [base, compare] = side === 'base' ? [edited, persisted] : [persisted, edited];

        const result = diffWorkflows(base, compare);

        expect(result.nodes.review.status).toBe('unchanged');
        expect(result.nodes.review.changes).toEqual([]);
        expect(result.summary.nodes).toEqual({ added: 0, removed: 0, changed: 0, cosmetic: 0, unchanged: 1 });
        expect(nodeFieldComparisons(result.nodes.review)).toEqual([]);
    });

    it.each(['base', 'compare'])('omits cleared output fields from details with edited payload on the %s side', (side) => {
        const edited = clearedHumanTaskWorkflow();
        const persisted: Workflow = JSON.parse(JSON.stringify(edited));
        const [base, compare] = side === 'base' ? [edited, persisted] : [persisted, edited];
        compare.nodes[0].config.description = 'Review the updated decision';

        const result = diffWorkflows(base, compare);

        expect(result.nodes.review.status).toBe('changed');
        expect(result.nodes.review.changes).toEqual(['config']);
        expect(result.summary.nodes.changed).toBe(1);
        expect(nodeFieldComparisons(result.nodes.review)).toEqual([
            { field: 'description', before: 'Review the decision', after: 'Review the updated decision' },
        ]);
    });

    it('ignores object key order at every depth, including objects inside arrays', () => {
        const base = workflow({
            actionType: 'send',
            inputs: { payload: { message: 'hello', enabled: true }, recipient: 'user' },
            outputs: [{ name: 'result', required: true }],
            extension: { first: 1, second: null },
        });
        const compare = workflow({
            extension: { second: null, first: 1 },
            outputs: [{ required: true, name: 'result' }],
            inputs: { recipient: 'user', payload: { enabled: true, message: 'hello' } },
            actionType: 'send',
        });

        const result = diffWorkflows(base, compare);

        expect(result.nodes.action.status).toBe('unchanged');
        expect(result.nodes.action.changes).toEqual([]);
        expect(result.summary.nodes).toEqual({ added: 0, removed: 0, changed: 0, cosmetic: 0, unchanged: 1 });
        expect(nodeFieldComparisons(result.nodes.action)).toEqual([]);
    });

    it('shows only genuinely changed fields when other fields have reordered keys', () => {
        const base = workflow({
            actionType: 'send',
            inputs: { payload: { first: 1, second: 2 } },
            outputs: [{ name: 'result', required: true }],
            extension: { first: 1, second: 2 },
        });
        const compare = workflow({
            actionType: 'receive',
            inputs: { payload: { second: 2, first: 1 } },
            outputs: [{ required: true, name: 'result' }],
            extension: { second: 2, first: 1 },
        });

        const result = diffWorkflows(base, compare);

        expect(result.nodes.action.status).toBe('changed');
        expect(result.nodes.action.changes).toEqual(['config']);
        expect(nodeFieldComparisons(result.nodes.action)).toEqual([
            { field: 'actionType', before: 'send', after: 'receive' },
        ]);
    });

    it.each([
        { label: 'scalar value', before: { value: 1 }, after: { value: 2 } },
        { label: 'scalar type', before: { value: 1 }, after: { value: '1' } },
        { label: 'null value', before: { value: null }, after: { value: false } },
        { label: 'added key', before: {}, after: { value: null } },
        { label: 'removed key', before: { value: null }, after: {} },
        { label: 'undefined property versus null', before: { value: undefined }, after: { value: null } },
        { label: 'different defined keys', before: { first: 1, second: undefined }, after: { first: undefined, second: 1 } },
        { label: 'array order', before: [1, 2], after: [2, 1] },
        { label: 'array length', before: [1], after: [1, 2] },
        { label: 'undefined array element versus null', before: [undefined], after: [null] },
        { label: 'undefined array element versus omission', before: [undefined], after: [] },
        { label: 'object array order', before: [{ id: 'a' }, { id: 'b' }], after: [{ id: 'b' }, { id: 'a' }] },
        { label: 'array versus object', before: [], after: {} },
    ])('preserves $label changes in summary and details', ({ before, after }) => {
        const result = diffWorkflows(workflow({ inputs: before }), workflow({ inputs: after }));

        expect(result.nodes.action.status).toBe('changed');
        expect(result.nodes.action.changes).toEqual(['config']);
        expect(result.summary.nodes.changed).toBe(1);
        expect(nodeFieldComparisons(result.nodes.action)).toEqual([{ field: 'inputs', before, after }]);
    });

    it('classifies a move with reordered config keys as cosmetic', () => {
        const result = diffWorkflows(
            workflow({ inputs: { first: 1, second: 2 } }),
            workflow({ inputs: { second: 2, first: 1 } }, { x: 10, y: 20 }),
        );

        expect(result.nodes.action.status).toBe('cosmetic');
        expect(result.nodes.action.changes).toEqual(['position']);
        expect(nodeFieldComparisons(result.nodes.action)).toEqual([
            { field: 'position', before: { x: 0, y: 0 }, after: { x: 10, y: 20 } },
        ]);
    });
});

describe.each([
    { label: 'omitted', position: undefined },
    { label: 'null', position: null },
    { label: 'NaN x', position: { x: NaN, y: 0 } },
    { label: 'infinite y', position: { x: 0, y: Infinity } },
    { label: 'negative infinite x', position: { x: -Infinity, y: 0 } },
    { label: 'missing coordinate', position: { x: 0 } },
    { label: 'nonnumeric coordinate', position: { x: '0', y: 0 } },
])('$label positions', ({ position }) => {
    function withPosition(): Workflow {
        const result = workflow({});
        if (position === undefined) {
            Reflect.deleteProperty(result.nodes[0], 'position');
        } else {
            result.nodes[0].position = position as WorkflowNode['position'];
        }
        return result;
    }

    it('treats two unusable positions as unspecified layout', () => {
        for (const compare of [withPosition(), workflow({}, null)]) {
            const result = diffWorkflows(withPosition(), compare);

            expect(result.nodes.action.status).toBe('unchanged');
            expect(result.nodes.action.changes).toEqual([]);
            expect(nodeFieldComparisons(result.nodes.action)).toEqual([]);
        }
    });

    it.each(['add', 'remove'])('classifies %s valid coordinates as cosmetic', (direction) => {
        const unpositioned = withPosition();
        const positioned = workflow({});
        const [base, compare] = direction === 'add' ? [unpositioned, positioned] : [positioned, unpositioned];
        const result = diffWorkflows(base, compare);

        expect(result.nodes.action.status).toBe('cosmetic');
        expect(result.nodes.action.changes).toEqual(['position']);
        expect(nodeFieldComparisons(result.nodes.action)).toEqual([
            { field: 'position', before: base.nodes[0].position, after: compare.nodes[0].position },
        ]);
    });
});
