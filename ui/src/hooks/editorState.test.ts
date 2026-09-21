import { describe, expect, it } from 'vitest';
import { createEditorState, editorReducer, type EditorCommand } from './editorState.ts';
import type { Workflow } from '../types/workflow.ts';

const workflow: Workflow = {
    id: 'original', name: 'Original', description: 'Before import', version: 1,
    nodes: [
        { id: 'start', name: 'Start', type: 'start', config: {}, position: { x: 0, y: 0 } },
        { id: 'end', name: 'End', type: 'end', config: {}, position: { x: 200, y: 0 } },
    ],
    edges: [{ id: 'edge', source: 'start', target: 'end', priority: 0, isDefault: false }],
};

describe('editor transactions', () => {
    it('discards old canvas selection when importing a different document with reused IDs', () => {
        let state = editorReducer(createEditorState(workflow), { type: 'edgesChange', changes: [
            { type: 'select', id: 'edge', selected: true },
        ] });
        state = editorReducer(state, { type: 'import', workflow: { ...workflow, id: 'imported' } });
        expect(state.edges[0].selected).not.toBe(true);
    });

    it('commits drag release once and treats keyboard movement as a completed position edit', () => {
        let state = editorReducer(createEditorState(workflow), { type: 'nodesChange', changes: [
            { type: 'position', id: 'start', position: { x: 25, y: 35 }, dragging: false },
        ] });
        expect(state.document.nodes[0].position).toEqual({ x: 25, y: 35 });
        expect(state.past).toHaveLength(1);
        expect(editorReducer(state, { type: 'commitPositions' })).toBe(state);
        state = editorReducer(state, { type: 'nodesChange', changes: [
            { type: 'position', id: 'start', position: { x: 30, y: 35 } },
        ] });
        expect(editorReducer(state, { type: 'undo' }).document.nodes[0].position).toEqual({ x: 25, y: 35 });
    });

    it('locks canvas commands centrally but permits property editing outside simulation', () => {
        let state = editorReducer(createEditorState(workflow), { type: 'mode', interactive: false });
        for (const command of [
            { type: 'addNode', node: { ...workflow.nodes[0], id: 'new' } },
            { type: 'cloneNode', id: 'end', newId: 'copy' },
            { type: 'delete', nodeIds: ['start'] }, { type: 'tidy' },
            { type: 'nodesChange', changes: [{ type: 'position', id: 'start', position: { x: 99, y: 99 } }] },
        ] satisfies EditorCommand[]) expect(editorReducer(state, command)).toBe(state);
        state = editorReducer(state, { type: 'nodeData', id: 'start', data: { name: 'Allowed' } });
        expect(state.document.nodes[0].name).toBe('Allowed');
        expect(editorReducer(state, { type: 'undo' }).document).toEqual(workflow);
    });

    it('accepts host metadata updates without replacing the locally edited graph', () => {
        let state = editorReducer(createEditorState(workflow), { type: 'nodeData', id: 'start', data: { name: 'Local' } });
        state = editorReducer(state, { type: 'metadata', metadata: { id: 'host', name: 'Host', version: 4 } });
        expect(state.document).toMatchObject({ id: 'host', name: 'Host', version: 4 });
        expect(state.document.description).toBeUndefined();
        expect(state.document.nodes[0].name).toBe('Local');
        expect(editorReducer(state, { type: 'undo' }).document).toMatchObject({ id: 'original', name: 'Original' });
    });

    it('retains measurements and canvas selection through rename, undo, and redo', () => {
        let state = editorReducer(createEditorState(workflow), { type: 'nodesChange', changes: [
            { type: 'dimensions', id: 'start', dimensions: { width: 123, height: 45 } },
            { type: 'select', id: 'start', selected: true },
        ] });
        state = editorReducer(state, { type: 'renameNode', id: 'start', newId: 'renamed' });
        expect(state.nodes[0]).toMatchObject({ id: 'renamed', selected: true, measured: { width: 123, height: 45 } });
        state = editorReducer(state, { type: 'undo' });
        expect(state.nodes[0]).toMatchObject({ id: 'start', selected: true, measured: { width: 123, height: 45 } });
        state = editorReducer(state, { type: 'redo' });
        expect(state.nodes[0]).toMatchObject({ id: 'renamed', selected: true, measured: { width: 123, height: 45 } });
    });

    it('records clone, connect, and combined node/edge deletion as individual undoable commands', () => {
        let state = editorReducer(createEditorState(workflow), { type: 'cloneNode', id: 'end', newId: 'copy' });
        expect(state.document.nodes[2]).toMatchObject({ id: 'copy', name: 'End (copy)', position: { x: 240, y: 40 } });
        state = editorReducer(state, { type: 'connect', id: 'newEdge', connection: {
            source: 'start', target: 'copy', sourceHandle: null, targetHandle: null,
        } });
        expect(state.document.edges.map(edge => edge.id)).toEqual(['edge', 'newEdge']);
        state = editorReducer(state, { type: 'delete', nodeIds: ['copy'], edgeIds: ['edge'] });
        expect(state.document.edges).toEqual([]);
        state = editorReducer(state, { type: 'undo' });
        expect(state.document.nodes.map(node => node.id)).toEqual(['start', 'end', 'copy']);
        expect(state.document.edges.map(edge => edge.id)).toEqual(['edge', 'newEdge']);
        state = editorReducer(editorReducer(state, { type: 'undo' }), { type: 'undo' });
        expect(state.document).toEqual(workflow);
    });

    it('bounds history and keeps graph extensions through property edits and tidy', () => {
        const extended = { ...workflow, extension: 'workflow', nodes: workflow.nodes.map(node => ({ ...node, extension: 'node' })),
            edges: workflow.edges.map(edge => ({ ...edge, extension: 'edge' })) };
        let state = createEditorState(extended);
        for (let index = 0; index < 55; index++) {
            state = editorReducer(state, { type: 'nodeData', id: 'start', data: { name: `Name ${index}` } });
        }
        expect(state.past).toHaveLength(50);
        const laidOut = editorReducer(state, { type: 'tidy' });
        expect(laidOut.document.nodes[1].position).not.toEqual(state.document.nodes[1].position);
        expect(laidOut.document).toMatchObject({ extension: 'workflow', nodes: [{ extension: 'node' }, { extension: 'node' }],
            edges: [{ extension: 'edge' }] });
        const undone = editorReducer(laidOut, { type: 'undo' });
        expect(undone.document).toEqual(state.document);
        expect(editorReducer(undone, { type: 'redo' }).document).toEqual(laidOut.document);
    });
    it('renames endpoints and selection atomically, with undo and redo', () => {
        const selected = editorReducer(createEditorState(workflow), { type: 'select', nodeId: 'start' });
        const renamed = editorReducer(selected, { type: 'renameNode', id: 'start', newId: 'renamed' });
        expect(renamed.document.nodes[0].id).toBe('renamed');
        expect(renamed.document.edges[0].source).toBe('renamed');
        expect(renamed.selectedNodeId).toBe('renamed');
        const undone = editorReducer(renamed, { type: 'undo' });
        expect(undone.document).toEqual(workflow);
        expect(undone.selectedNodeId).toBe('start');
        expect(editorReducer(undone, { type: 'redo' }).document).toEqual(renamed.document);
    });

    it('deletes incident edges and clears invalid selection in the same transaction', () => {
        const selected = editorReducer(createEditorState(workflow), { type: 'select', edgeId: 'edge' });
        const deleted = editorReducer(selected, { type: 'delete', nodeIds: ['start'] });
        expect(deleted.document.nodes.map(node => node.id)).toEqual(['end']);
        expect(deleted.document.edges).toEqual([]);
        expect(deleted.selectedEdgeId).toBeNull();
        expect(editorReducer(deleted, { type: 'undo' }).document).toEqual(workflow);
    });

    it('coalesces typing within a field and separates blur, fields, and undo branches', () => {
        let state = createEditorState(workflow);
        state = editorReducer(state, { type: 'nodeData', id: 'start', data: { name: 'S' }, group: 'name' });
        state = editorReducer(state, { type: 'nodeData', id: 'start', data: { name: 'Sample' }, group: 'name' });
        state = editorReducer(state, { type: 'endGroup' });
        state = editorReducer(state, { type: 'nodeData', id: 'start', data: { config: { inputs: [] } }, group: 'config' });
        state = editorReducer(state, { type: 'undo' });
        expect(state.document.nodes[0]).toMatchObject({ name: 'Sample', config: {} });
        state = editorReducer(state, { type: 'undo' });
        expect(state.document).toEqual(workflow);
        state = editorReducer(state, { type: 'nodeData', id: 'start', data: { name: 'Branch' }, group: 'name' });
        expect(state.future).toHaveLength(0);
        expect(editorReducer(state, { type: 'undo' }).document).toEqual(workflow);
    });

    it('records edge properties and coalesced node-ID typing', () => {
        let state = createEditorState(workflow);
        state = editorReducer(state, { type: 'edgeData', id: 'edge', data: { condition: '${true}', label: 'Go' } });
        state = editorReducer(state, { type: 'renameNode', id: 'start', newId: 's', group: 'id' });
        state = editorReducer(state, { type: 'renameNode', id: 's', newId: 'source', group: 'id' });
        state = editorReducer(state, { type: 'undo' });
        expect(state.document.nodes[0].id).toBe('start');
        expect(state.document.edges[0]).toMatchObject({ source: 'start', condition: '${true}', label: 'Go' });
        expect(editorReducer(state, { type: 'undo' }).document).toEqual(workflow);
    });

    it('undoes and redoes imported identity, metadata, graph, and extension fields', () => {
        const imported = { ...workflow, id: 'imported', name: 'Imported', version: 2,
            description: 'After import', extension: { owner: 'host' }, nodes: [], edges: [] };
        const state = editorReducer(createEditorState(workflow), { type: 'import', workflow: imported });
        const undone = editorReducer(state, { type: 'undo' });
        expect(undone.document).toEqual(workflow);
        expect(editorReducer(undone, { type: 'redo' }).document).toEqual(imported);
    });

    it('records the completed layout so redo restores its positions', () => {
        const state = editorReducer(createEditorState(workflow), {
            type: 'positions', positions: { start: { x: 50, y: 80 }, end: { x: 50, y: 300 } },
        });
        const undone = editorReducer(state, { type: 'undo' });
        expect(undone.document).toEqual(workflow);
        expect(editorReducer(undone, { type: 'redo' }).document.nodes.map(node => node.position))
            .toEqual([{ x: 50, y: 80 }, { x: 50, y: 300 }]);
    });

    it('keeps measurements and selection out of history and preserves them across undo', () => {
        let state = createEditorState(workflow);
        state = editorReducer(state, { type: 'nodesChange', changes: [
            { type: 'dimensions', id: 'start', dimensions: { width: 123, height: 45 } },
            { type: 'select', id: 'start', selected: true },
        ] });
        expect(state.document).toEqual(workflow);
        expect(state.past).toHaveLength(0);
        expect(state.revision).toBe(0);
        state = editorReducer(state, { type: 'nodeData', id: 'start', data: { name: 'Changed' } });
        state = editorReducer(state, { type: 'undo' });
        expect(state.nodes[0]).toMatchObject({ selected: true, measured: { width: 123, height: 45 } });
    });

    it('commits a multi-frame drag once, retaining its original undo position', () => {
        let state = createEditorState(workflow);
        for (const x of [10, 20, 30]) {
            state = editorReducer(state, { type: 'nodesChange', changes: [
                { type: 'position', id: 'start', position: { x, y: 40 }, dragging: true },
            ] });
        }
        expect(state.document).toEqual(workflow);
        expect(state.revision).toBe(0);
        state = editorReducer(state, { type: 'commitPositions' });
        expect(state.document.nodes[0].position).toEqual({ x: 30, y: 40 });
        expect(editorReducer(state, { type: 'undo' }).document).toEqual(workflow);
        expect(editorReducer(state, { type: 'commitPositions' })).toBe(state);
    });

    it('rejects invalid/no-op commands without notifications or redo loss', () => {
        let state = editorReducer(createEditorState(workflow), { type: 'nodeData', id: 'start', data: { name: 'New' } });
        state = editorReducer(state, { type: 'undo' });
        for (const command of [
            { type: 'renameNode', id: 'start', newId: 'end' },
            { type: 'renameNode', id: 'start', newId: '' },
            { type: 'renameNode', id: 'missing', newId: 'new' },
            { type: 'nodeData', id: 'start', data: { name: 'Start' } },
            { type: 'delete', nodeIds: ['missing'] },
            { type: 'connect', connection: { source: 'missing', target: 'end', sourceHandle: null, targetHandle: null }, id: 'bad' },
        ] satisfies EditorCommand[]) {
            expect(editorReducer(state, command)).toBe(state);
        }
    });

    it('is deterministic and leaves prior state and command payloads untouched under reducer replay', () => {
        const state = createEditorState(workflow);
        const before = structuredClone(state);
        const nested = ['value'];
        const command: EditorCommand = { type: 'nodeData', id: 'start', data: { config: { nested } } };
        const first = editorReducer(state, command);
        expect(editorReducer(state, command)).toEqual(first);
        expect(state).toEqual(before);
        nested.push('external mutation');
        expect(first.document.nodes[0].config).toEqual({ nested: ['value'] });
    });

    it('blocks every document command during simulation, including late import and flow events', () => {
        const edited = editorReducer(createEditorState(workflow), { type: 'nodeData', id: 'start', data: { name: 'Edited' } });
        const state = editorReducer(edited, { type: 'mode', simulating: true });
        const commands: EditorCommand[] = [
            { type: 'nodeData', id: 'start', data: { name: 'Blocked' } },
            { type: 'edgeData', id: 'edge', data: { label: 'Blocked' } },
            { type: 'renameNode', id: 'start', newId: 'blocked' },
            { type: 'delete', nodeIds: ['start'] },
            { type: 'addNode', node: { ...workflow.nodes[0], id: 'new' } },
            { type: 'cloneNode', id: 'start', newId: 'clone' },
            { type: 'connect', id: 'newEdge', connection: { source: 'end', target: 'start', sourceHandle: null, targetHandle: null } },
            { type: 'import', workflow: { ...workflow, id: 'blocked' } },
            { type: 'positions', positions: { start: { x: 99, y: 99 } } },
            { type: 'tidy' }, { type: 'metadata', metadata: { id: 'blocked', name: 'Blocked' } },
            { type: 'commitPositions' }, { type: 'undo' }, { type: 'redo' },
            { type: 'nodesChange', changes: [{ type: 'remove', id: 'start' }] },
            { type: 'edgesChange', changes: [{ type: 'remove', id: 'edge' }] },
        ];
        for (const command of commands) {
            expect(editorReducer(state, command).document).toBe(state.document);
            expect(editorReducer(state, command).revision).toBe(state.revision);
        }
        const measured = editorReducer(state, { type: 'nodesChange', changes: [
            { type: 'dimensions', id: 'start', dimensions: { width: 100, height: 60 } },
        ] });
        expect(measured.nodes[0].measured).toEqual({ width: 100, height: 60 });
    });
});
