import { describe, expect, it, vi } from 'vitest';
import { createEditorState, editorReducer, type EditorCommand, type EditorState } from './editorState.ts';
import { readOnlyCommand } from './editorReadOnly.ts';
import { editorShortcut } from './editorShortcuts.ts';
import { createDocumentPublisher } from './editorNotifications.ts';
import type { Workflow } from '../types/workflow.ts';

const workflow: Workflow = {
    id: 'wf', name: 'Workflow', version: 1,
    nodes: [
        { id: 'start', name: 'Start', type: 'start', config: {}, position: { x: 0, y: 0 } },
        { id: 'end', name: 'End', type: 'end', config: {}, position: { x: 200, y: 0 } },
    ],
    edges: [{ id: 'edge', source: 'start', target: 'end', priority: 0, isDefault: false }],
};

/** Applies commands the way the read-only editor does: filtered, then reduced. */
function applyReadOnly(state: EditorState, commands: EditorCommand[]): EditorState {
    return commands.reduce((current, command) => {
        const allowed = readOnlyCommand(command);
        return allowed ? editorReducer(current, allowed) : current;
    }, state);
}

const mutations: EditorCommand[] = [
    { type: 'addNode', node: { ...workflow.nodes[1], id: 'added' } },
    { type: 'cloneNode', id: 'end', newId: 'copy' },
    { type: 'delete', nodeIds: ['end'], edgeIds: ['edge'] },
    { type: 'connect', id: 'e2', connection: { source: 'end', target: 'start', sourceHandle: null, targetHandle: null } },
    { type: 'nodeData', id: 'start', data: { name: 'Renamed' } },
    { type: 'edgeData', id: 'edge', data: { condition: 'x' } },
    { type: 'renameNode', id: 'start', newId: 'begin' },
    { type: 'import', workflow: { ...workflow, nodes: [] } },
    { type: 'tidy' },
    { type: 'positions', positions: { start: { x: 50, y: 50 } } },
    { type: 'commitPositions' },
    { type: 'undo' },
    { type: 'redo' },
    { type: 'mode', interactive: false },
    { type: 'mode', simulating: true },
];

describe('read-only editor', () => {
    it.each(mutations)('drops mutating command $type', command => {
        expect(readOnlyCommand(command)).toBeNull();
    });

    it('never mutates the document through canvas interactions', () => {
        const initial = createEditorState(workflow);
        const after = applyReadOnly(initial, [
            ...mutations,
            { type: 'nodesChange', changes: [
                { type: 'position', id: 'start', position: { x: 99, y: 99 }, dragging: false },
                { type: 'remove', id: 'end' },
            ] },
            { type: 'edgesChange', changes: [{ type: 'remove', id: 'edge' }] },
        ]);
        expect(after.document).toEqual(initial.document);
        expect(after.revision).toBe(initial.revision);
        expect(after.nodes.map(node => node.position)).toEqual(initial.nodes.map(node => node.position));
        expect(after.past).toHaveLength(0);
    });

    it('still allows selection and measurement but not entering simulation', () => {
        const initial = createEditorState(workflow);
        const after = applyReadOnly(initial, [
            { type: 'nodesChange', changes: [
                { type: 'select', id: 'start', selected: true },
                { type: 'position', id: 'start', position: { x: 5, y: 5 } },
            ] },
            { type: 'select', nodeId: 'start' },
            { type: 'mode', simulating: true, interactive: false },
        ]);
        expect(after.selectedNodeId).toBe('start');
        expect(after.nodes.find(node => node.id === 'start')?.selected).toBe(true);
        expect(after.nodes.find(node => node.id === 'start')?.position).toEqual({ x: 0, y: 0 });
        expect(after.simulating).toBe(false);
        expect(after.interactive).toBe(initial.interactive);
        expect(readOnlyCommand({ type: 'edgesChange', changes: [{ type: 'select', id: 'edge', selected: true }] }))
            .not.toBeNull();
    });

    it('allows leaving a simulation that was active before switching to read-only', () => {
        const simulating = editorReducer(createEditorState(workflow), { type: 'mode', simulating: true });
        const after = applyReadOnly(simulating, [{ type: 'mode', simulating: false }]);
        expect(after.simulating).toBe(false);
    });

    it('never publishes onChange', () => {
        const onChange = vi.fn();
        const publish = createDocumentPublisher();
        let state = createEditorState(workflow);
        publish(state, onChange);
        state = applyReadOnly(state, mutations);
        publish(state, onChange);
        expect(onChange).not.toHaveBeenCalled();
    });

    it('ignores keyboard delete and undo/redo shortcuts', () => {
        expect(editorShortcut({ key: 'Delete' }, true, false, false, true)).toBeNull();
        expect(editorShortcut({ key: 'Backspace' }, true, false, false, true)).toBeNull();
        expect(editorShortcut({ key: 'z', ctrlKey: true }, true, false, false, true)).toBeNull();
        expect(editorShortcut({ key: 'y', ctrlKey: true }, true, false, false, true)).toBeNull();
        expect(editorShortcut({ key: 'Delete' }, true, false, false)).toBe('delete');
    });
});
