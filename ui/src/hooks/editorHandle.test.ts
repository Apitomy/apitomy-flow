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

function harness(readOnly = false) {
    let state: EditorState = createEditorState(workflow());
    const handle = createEditorHandle({
        state: () => state,
        dispatch: (command: EditorCommand) => {
            const allowed = command.type === 'import' ? command : readOnly ? readOnlyCommand(command) : command;
            if (allowed) state = editorReducer(state, allowed);
        },
        readOnly: () => readOnly,
        problems: () => [],
    });
    return { handle, state: () => state };
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
