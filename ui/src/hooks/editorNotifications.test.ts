import { describe, expect, it } from 'vitest';
import { createDocumentPublisher } from './editorNotifications.ts';
import { createEditorState, editorReducer } from './editorState.ts';
import type { Workflow } from '../types/workflow.ts';

const workflow: Workflow = {
    id: 'test', name: 'Test', nodes: [
        { id: 'a', type: 'start', name: 'A', config: {}, position: { x: 0, y: 0 } },
        { id: 'b', type: 'end', name: 'B', config: {}, position: { x: 200, y: 0 } },
    ], edges: [{ id: 'ab', source: 'a', target: 'b', priority: 0, isDefault: false }],
};

describe('committed document notifications', () => {
    it('suppresses mount, presentation, and replay notifications while publishing complete transactions', () => {
        const publish = createDocumentPublisher();
        const received: Workflow[] = [];
        const onChange = (document: Workflow) => received.push(document);
        let state = createEditorState(workflow);
        publish(state, onChange);
        state = editorReducer(state, { type: 'nodesChange', changes: [{ type: 'select', id: 'a', selected: true }] });
        publish(state, onChange);
        expect(received).toEqual([]);
        state = editorReducer(state, { type: 'renameNode', id: 'a', newId: 'renamed' });
        publish(state, onChange);
        publish(state, document => received.push(document)); // effect replay / changed callback identity
        expect(received).toHaveLength(1);
        expect(received[0].nodes[0].id).toBe('renamed');
        expect(received[0].edges[0].source).toBe('renamed');
        state = editorReducer(state, { type: 'delete', nodeIds: ['renamed'] });
        publish(state, onChange);
        expect(received[1].nodes.map(node => node.id)).toEqual(['b']);
        expect(received[1].edges).toEqual([]);
        state = editorReducer(state, { type: 'undo' });
        publish(state, onChange);
        expect(received[2]).toEqual(received[0]);
    });

    it('isolates host mutation from both current document and undo history', () => {
        const publish = createDocumentPublisher();
        const state = editorReducer(createEditorState(workflow), { type: 'nodeData', id: 'a', data: { name: 'New' } });
        publish(state, document => {
            document.nodes[0].name = 'Host mutation';
            document.nodes[0].config.external = true;
            document.edges.length = 0;
        });
        expect(state.document.nodes[0]).toMatchObject({ name: 'New', config: {} });
        expect(state.document.edges).toHaveLength(1);
        expect(editorReducer(state, { type: 'undo' }).document).toEqual(workflow);
    });

    it('publishes mount fallback layout once without making it undoable', () => {
        const publish = createDocumentPublisher();
        const received: Workflow[] = [];
        const state = createEditorState({ ...workflow, nodes: workflow.nodes.map(node => ({ ...node, position: { x: 0, y: 0 } })) });
        publish(state, document => received.push(document));
        publish(state, document => received.push(document));
        expect(received).toHaveLength(1);
        expect(received[0].nodes[1].position!.x).toBeGreaterThan(received[0].nodes[0].position!.x);
        expect(editorReducer(state, { type: 'undo' })).toBe(state);
    });
});
