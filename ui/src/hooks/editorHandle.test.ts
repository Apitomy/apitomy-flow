import { describe, it, expect } from 'vitest';
import { createEditorState, editorReducer, type EditorCommand, type EditorState } from './editorState.ts';
import { readOnlyCommand } from './editorReadOnly.ts';
import { createEditorHandle } from './editorHandle.ts';
import type { ChangeSet } from '../changeset/types.ts';
import type { Workflow } from '../types/workflow.ts';

const workflow = (): Workflow => ({ id: 'w', name: 'W', nodes: [
    { id: 's', type: 'start', name: 'S', config: {}, position: { x: 0, y: 0 } },
    { id: 'e', type: 'end', name: 'E', config: {}, position: { x: 300, y: 0 } },
], edges: [{ id: 'se', source: 's', target: 'e', priority: 0, isDefault: false }] });

function harness(readOnly = false, layout: 'place' | 'tidy' = 'place') {
    let state: EditorState = createEditorState(workflow());
    const handle = createEditorHandle({
        state: () => state,
        dispatch: (command: EditorCommand) => {
            const allowed = command.type === 'import' ? command : readOnly ? readOnlyCommand(command) : command;
            if (allowed) state = editorReducer(state, allowed);
        },
        readOnly: () => readOnly,
        problems: () => [],
        layout: () => layout,
    });
    return { handle, state: () => state, dispatch: (command: EditorCommand) => { state = editorReducer(state, command); } };
}

const rename = (baseRevision: string, id = 'cs'): ChangeSet =>
    ({ id, baseRevision, author: 'agent:t', summary: 'Rename', ops: [{ op: 'metadata', patch: { name: 'New' } }] });

describe('createEditorHandle', () => {
    it('stages a valid proposal', () => {
        const { handle, state } = harness();
        expect(handle.propose(rename(handle.getSnapshot().contentRevision))).toEqual({ status: 'staged' });
        expect(state().proposal?.preview.name).toBe('New');
    });

    it('rejects stale and invalid change sets with codes', () => {
        const { handle } = harness();
        expect(handle.propose(rename('sha256:old'))).toMatchObject({ status: 'rejected', error: { code: 'stale' } });
        const bad: ChangeSet = { ...rename(handle.getSnapshot().contentRevision), ops: [{ op: 'removeNode', id: 'nope' }] };
        expect(handle.apply(bad)).toMatchObject({ status: 'rejected', error: { code: 'target-missing', opIndex: 0 } });
    });

    it('rejects a change set that cannot be cloned as malformed instead of throwing', () => {
        const { handle, state } = harness();
        const revision = handle.getSnapshot().contentRevision;
        const bad = { ...rename(revision), ops: [{ op: 'metadata', patch: { name: 'X', fn: () => 1 } }] } as unknown as ChangeSet;
        const proposed = handle.propose(bad);
        expect(proposed.status === 'rejected' && proposed.error.code).toBe('malformed');
        const applied = handle.apply(bad);
        expect(applied.status === 'rejected' && applied.error.code).toBe('malformed');
        expect(state().proposal).toBeNull();
    });

    it('applies and advances the revision', () => {
        const { handle, state } = harness();
        const before = handle.getSnapshot().contentRevision;
        expect(handle.apply(rename(before))).toEqual({ status: 'applied' });
        expect(handle.getSnapshot().contentRevision).not.toBe(before);
        expect(state().origin).toBe('agent:t');
    });

    it('refuses to apply when read-only but still previews', () => {
        const { handle } = harness(true);
        const revision = handle.getSnapshot().contentRevision;
        expect(handle.apply(rename(revision))).toMatchObject({ status: 'rejected', error: { code: 'read-only' } });
        expect(handle.propose(rename(revision))).toEqual({ status: 'staged' });
    });

    it('replaces the document as a host change that keeps existing positions', () => {
        const { handle, state } = harness();
        const next = workflow();
        next.nodes.push({ id: 'x', type: 'wait', name: 'X', config: {} });
        handle.replace(next);
        expect(state().origin).toBe('host');
        expect(state().document.nodes[0].position).toEqual({ x: 0, y: 0 });
        expect(state().document.nodes[2].position).toBeDefined();
    });

    it('withdraws, clears highlights and returns detached snapshots', () => {
        const { handle, state } = harness();
        handle.apply(rename(handle.getSnapshot().contentRevision, 'a'));
        handle.clearHighlights();
        expect(state().highlight).toBeNull();
        handle.propose(rename(handle.getSnapshot().contentRevision, 'b'));
        handle.withdraw('b');
        expect(state().proposal).toBeNull();
        const snapshot = handle.getSnapshot();
        snapshot.workflow.nodes.length = 0;
        expect(state().document.nodes).toHaveLength(2);
        expect(snapshot.selection).toEqual({ nodeIds: [], edgeIds: [] });
    });
});

describe('applied change layout', () => {
    const addEnd = (baseRevision: string): ChangeSet => ({ id: 'add', baseRevision, author: 'agent:t', summary: 'Add',
        ops: [{ op: 'addNode', node: { id: 'x', type: 'end', name: 'X', config: {} } },
            { op: 'addEdge', edge: { id: 'sx', source: 's', target: 'x', priority: 0, isDefault: false } }] });
    const position = (document: { nodes: { id: string; position?: unknown }[] }, id: string) =>
        document.nodes.find(node => node.id === id)?.position;

    it("previews and applies tidied layouts when the host chooses 'tidy'", () => {
        const placed = harness(false, 'place');
        const tidied = harness(false, 'tidy');
        placed.handle.propose(addEnd(placed.handle.getSnapshot().contentRevision));
        tidied.handle.propose(addEnd(tidied.handle.getSnapshot().contentRevision));
        expect(position(tidied.state().proposal!.preview, 's')).not.toEqual(position(placed.state().proposal!.preview, 's'));
        expect(position(placed.state().proposal!.preview, 's')).toEqual({ x: 0, y: 0 });

        const applied = harness(false, 'tidy');
        applied.handle.apply(addEnd(applied.handle.getSnapshot().contentRevision));
        expect(position(applied.state().document, 's')).not.toEqual({ x: 0, y: 0 });
    });
});

describe('handle while simulating (#192)', () => {
    it.each(['apply', 'propose'] as const)('%s leaves simulation mode before changing the document', method => {
        const { handle, state, dispatch } = harness();
        dispatch({ type: 'mode', simulating: true });
        expect(state().simulating).toBe(true);
        expect(handle[method](rename(handle.getSnapshot().contentRevision)).status).not.toBe('rejected');
        expect(state().simulating).toBe(false);
    });

    it('keeps simulating when the change set is rejected', () => {
        const { handle, state, dispatch } = harness();
        dispatch({ type: 'mode', simulating: true });
        expect(handle.apply(rename('sha256:old')).status).toBe('rejected');
        expect(state().simulating).toBe(true);
    });

    describe('select', () => {
        function revealHarness() {
            let state: EditorState = createEditorState(workflow());
            const reveals: unknown[] = [];
            const handle = createEditorHandle({
                state: () => state,
                dispatch: (command: EditorCommand) => { state = editorReducer(state, command); },
                readOnly: () => false,
                problems: () => [],
                reveal: (target, center) => { reveals.push({ target, center }); },
            });
            return { handle, state: () => state, reveals };
        }

        it('selects a node and reveals it without centering by default', () => {
            const { handle, state, reveals } = revealHarness();
            handle.select({ nodeId: 'e' });
            expect(state().selectedNodeId).toBe('e');
            expect(reveals).toEqual([{ target: { nodeId: 'e' }, center: false }]);
        });

        it('selects an edge and centers it on request', () => {
            const { handle, state, reveals } = revealHarness();
            handle.select({ edgeId: 'se' }, { center: true });
            expect(state().selectedEdgeId).toBe('se');
            expect(reveals).toEqual([{ target: { edgeId: 'se' }, center: true }]);
        });

        it('clears the selection for null', () => {
            const { handle, state, reveals } = revealHarness();
            handle.select({ nodeId: 's' });
            handle.select(null, { center: true });
            expect(state().selectedNodeId).toBeNull();
            expect(state().selectedEdgeId).toBeNull();
            expect(reveals.at(-1)).toEqual({ target: null, center: false });
        });

        it('clears the selection for unknown ids', () => {
            const { handle, state, reveals } = revealHarness();
            handle.select({ nodeId: 's' });
            handle.select({ nodeId: 'missing' }, { center: true });
            expect(state().selectedNodeId).toBeNull();
            expect(reveals.at(-1)).toEqual({ target: null, center: false });
        });

        it('keeps both ids like dispatch and reveals the node', () => {
            const { handle, state, reveals } = revealHarness();
            handle.select({ nodeId: 's', edgeId: 'se' }, { center: true });
            expect(state().selectedNodeId).toBe('s');
            expect(state().selectedEdgeId).toBe('se');
            expect(reveals).toEqual([{ target: { nodeId: 's' }, center: true }]);
        });

        it('selects even when read-only', () => {
            const { handle, state } = harness(true);
            handle.select({ nodeId: 'e' });
            expect(state().selectedNodeId).toBe('e');
        });
    });
});
