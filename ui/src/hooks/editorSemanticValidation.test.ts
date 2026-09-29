import { describe, expect, it } from 'vitest';
import { createEditorState, editorReducer, type EditorCommand } from './editorState.ts';
import { validateWorkflow } from '../validation/validateWorkflow.ts';
import type { Workflow } from '../types/workflow.ts';

const workflow: Workflow = { id: 'semantic', name: 'Semantic', nodes: [
    { id: 's', name: 'Start', type: 'start', config: {}, position: { x: 0, y: 0 } },
    { id: 'e', name: 'End', type: 'end', config: {}, position: { x: 300, y: 0 } },
], edges: [{ id: 'edge', source: 's', target: 'e', priority: 0, isDefault: false }] };

describe('semantic validation ownership', () => {
    it('retains one validation input through selection, drag, tidy and layout undo/redo', () => {
        let state = createEditorState(workflow);
        const semantic = state.semanticDocument;
        expect(semantic).toBeDefined();
        for (const command of [
            { type: 'select', nodeId: 's' },
            { type: 'nodesChange', changes: [{ type: 'position', id: 's', position: { x: 10, y: 20 }, dragging: true }] },
            { type: 'commitPositions' }, { type: 'tidy' }, { type: 'undo' }, { type: 'redo' },
        ] satisfies EditorCommand[]) {
            state = editorReducer(state, command);
            expect(state.semanticDocument).toBe(semantic);
        }
        expect(state.document).not.toBe(workflow);
    });

    it('invalidates on semantic edits and restores the matching input on undo/redo', () => {
        const initial = createEditorState(workflow);
        const changed = editorReducer(initial, { type: 'delete', edgeIds: ['edge'] });
        expect(changed.semanticDocument).not.toBe(initial.semanticDocument);
        expect(validateWorkflow(changed.semanticDocument).some(problem => problem.severity === 'error')).toBe(true);
        const undone = editorReducer(changed, { type: 'undo' });
        expect(undone.semanticDocument).toBe(initial.semanticDocument);
        expect(editorReducer(undone, { type: 'redo' }).semanticDocument).toBe(changed.semanticDocument);
        const imported = editorReducer(initial, { type: 'import', workflow: { ...workflow, name: 'Changed metadata' } });
        expect(imported.semanticDocument.name).toBe('Changed metadata');
        const positioned = editorReducer(initial, { type: 'import', workflow: {
            ...workflow, nodes: workflow.nodes.map(node => ({ ...node, position: { x: 70, y: 30 } })),
        } });
        expect(positioned.semanticDocument).toBe(initial.semanticDocument);
    });

    it('invalidates config, routing and host extension changes even with the same workflow id/version', () => {
        const initial = createEditorState(workflow);
        const extended: Workflow = structuredClone(workflow);
        for (const node of extended.nodes) node.config.extension = { enabled: true };
        for (const command of [
            { type: 'nodeData', id: 's', data: { config: { inputs: [{ name: 'required', type: 'string', required: true }] } } },
            { type: 'edgeData', id: 'edge', data: { condition: 'context.enabled' } },
            { type: 'import', workflow: extended },
        ] satisfies EditorCommand[]) {
            const changed = editorReducer(initial, command);
            expect(changed.semanticDocument).not.toBe(initial.semanticDocument);
            expect(changed.semanticDocument).toBe(changed.document);
            expect(initial.semanticDocument).toEqual(workflow);
        }
    });
});
