import { describe, it, expect } from 'vitest';
import { createEditorState, editorReducer, type EditorState } from './editorState.ts';
import { applyChangeSetChecked } from '../changeset/applyChangeSet.ts';
import type { ChangeSet } from '../changeset/types.ts';
import type { Workflow } from '../types/workflow.ts';

const workflow = (): Workflow => ({ id: 'w', name: 'W', nodes: [
    { id: 's', type: 'start', name: 'S', config: {}, position: { x: 0, y: 0 } },
    { id: 'a', type: 'action', name: 'A', config: {}, position: { x: 200, y: 0 } },
    { id: 'e', type: 'end', name: 'E', config: {}, position: { x: 400, y: 0 } },
], edges: [
    { id: 'sa', source: 's', target: 'a', priority: 0, isDefault: false },
    { id: 'ae', source: 'a', target: 'e', priority: 0, isDefault: false },
] });

const addWait = (state: EditorState, id = 'cs-1'): ChangeSet => ({ id, baseRevision: state.contentRevision,
    author: 'agent:test', summary: 'Add wait', ops: [
        { op: 'removeEdge', id: 'ae' },
        { op: 'addNode', node: { id: 'w', type: 'wait', name: 'Wait', config: { duration: 'PT1M' } } },
        { op: 'addEdge', edge: { id: 'aw', source: 'a', target: 'w', priority: 0, isDefault: false } },
        { op: 'addEdge', edge: { id: 'we', source: 'w', target: 'e', priority: 0, isDefault: false } },
    ] });

function propose(state: EditorState, changeSet: ChangeSet): EditorState {
    const result = applyChangeSetChecked(state.document, changeSet, state.contentRevision);
    if (!result.ok) throw new Error(result.error.reason);
    return editorReducer(state, { type: 'propose', changeSet, preview: result.workflow });
}

const outcomes = (state: EditorState) => state.proposalEvents.map(event => `${event.id}:${event.outcome}`);
const rename = (state: EditorState) => editorReducer(state, { type: 'nodeData', id: 'a', data: { name: 'Edited' } });

describe('applyChangeSet', () => {
    it('applies as one undo step tagged with the author', () => {
        const initial = createEditorState(workflow());
        const applied = editorReducer(initial, { type: 'applyChangeSet', changeSet: addWait(initial) });
        expect(applied.document.nodes.map(node => node.id)).toContain('w');
        expect(applied.past).toHaveLength(initial.past.length + 1);
        expect(applied.origin).toBe('agent:test');
        const undone = editorReducer(applied, { type: 'undo' });
        expect(undone.document.nodes.map(node => node.id)).not.toContain('w');
        expect(undone.contentRevision).toBe(initial.contentRevision);
        expect(undone.origin).toBe('user');
    });

    it('ignores a stale change set', () => {
        const initial = createEditorState(workflow());
        const stale = { ...addWait(initial), baseRevision: 'sha256:old' };
        expect(editorReducer(initial, { type: 'applyChangeSet', changeSet: stale })).toBe(initial);
    });

    it('highlights added and modified elements and keeps them across layout edits', () => {
        const initial = createEditorState(workflow());
        const applied = editorReducer(initial, { type: 'applyChangeSet', changeSet: addWait(initial) });
        expect(applied.highlight).toEqual({ nodeIds: ['w'], edgeIds: ['aw', 'we'] });
        const moved = editorReducer(editorReducer(applied, { type: 'positions', positions: { s: { x: 5, y: 5 } } }),
            { type: 'commitPositions' });
        expect(moved.highlight).not.toBeNull();
        expect(rename(moved).highlight).toBeNull();
        expect(editorReducer(applied, { type: 'clearHighlights' }).highlight).toBeNull();
    });

    it('keeps the highlight across host metadata changes', () => {
        const initial = createEditorState(workflow());
        const applied = editorReducer(initial, { type: 'applyChangeSet', changeSet: addWait(initial) });
        const hosted = editorReducer(applied, { type: 'metadata', metadata: { id: 'w', name: 'Host' } });
        expect(hosted.origin).toBe('host');
        expect(hosted.highlight).not.toBeNull();
    });
});

describe('proposals', () => {
    it('stages without touching the document or history', () => {
        const initial = createEditorState(workflow());
        const staged = propose(initial, addWait(initial));
        expect(staged.document).toBe(initial.document);
        expect(staged.past).toBe(initial.past);
        expect(staged.proposal?.stale).toBe(false);
    });

    it('withdraws the previous proposal when a new one is staged', () => {
        const initial = createEditorState(workflow());
        const second = propose(propose(initial, addWait(initial, 'cs-1')), addWait(initial, 'cs-2'));
        expect(outcomes(second)).toEqual(['cs-1:withdrawn']);
        expect(second.proposal?.changeSet.id).toBe('cs-2');
    });

    it('goes stale once on content edits after a layout-only undo, but not on layout edits', () => {
        const initial = rename(createEditorState(workflow()));
        const staged = propose(initial, addWait(initial));
        const moved = editorReducer(editorReducer(staged, { type: 'positions', positions: { s: { x: 9, y: 9 } } }),
            { type: 'commitPositions' });
        expect(moved.proposal?.stale).toBe(false);
        const undone = editorReducer(moved, { type: 'undo' });
        const edit = (state: EditorState, name: string) =>
            editorReducer(state, { type: 'nodeData', id: 'a', data: { name } });
        const twice = edit(edit(undone, 'Again'), 'Once more');
        expect(twice.proposal?.stale).toBe(true);
        expect(outcomes(twice)).toEqual(['cs-1:stale']);
    });

    it('goes stale once when a content-changing undo runs', () => {
        const initial = rename(createEditorState(workflow()));
        const staged = propose(initial, addWait(initial));
        const undone = editorReducer(staged, { type: 'undo' });
        expect(undone.contentRevision).not.toBe(staged.contentRevision);
        expect(undone.proposal?.stale).toBe(true);
        const redone = editorReducer(undone, { type: 'redo' });
        expect(outcomes(redone)).toEqual(['cs-1:stale']);
    });

    it('accepts a fresh proposal and ignores accept when stale', () => {
        const initial = createEditorState(workflow());
        const accepted = editorReducer(propose(initial, addWait(initial)), { type: 'acceptProposal' });
        expect(accepted.proposal).toBeNull();
        expect(accepted.origin).toBe('agent:test');
        expect(outcomes(accepted)).toEqual(['cs-1:accepted']);
        const stale = rename(propose(initial, addWait(initial)));
        expect(editorReducer(stale, { type: 'acceptProposal' })).toBe(stale);
    });

    it('rejects with an event, and dismisses a stale proposal silently', () => {
        const initial = createEditorState(workflow());
        const rejected = editorReducer(propose(initial, addWait(initial)), { type: 'rejectProposal' });
        expect(rejected.proposal).toBeNull();
        expect(outcomes(rejected)).toEqual(['cs-1:rejected']);
        const dismissed = editorReducer(rename(propose(initial, addWait(initial))), { type: 'rejectProposal' });
        expect(dismissed.proposal).toBeNull();
        expect(outcomes(dismissed)).toEqual(['cs-1:stale']);
    });

    it('withdraws only a matching id', () => {
        const initial = createEditorState(workflow());
        const staged = propose(initial, addWait(initial));
        expect(editorReducer(staged, { type: 'withdraw', id: 'other' })).toBe(staged);
        expect(outcomes(editorReducer(staged, { type: 'withdraw', id: 'cs-1' }))).toEqual(['cs-1:withdrawn']);
    });

    it('marks the staged proposal stale when a different change set is applied', () => {
        const initial = createEditorState(workflow());
        const staged = propose(initial, addWait(initial, 'cs-1'));
        const other: ChangeSet = { id: 'cs-2', baseRevision: initial.contentRevision, author: 'host', summary: 'Rename',
            ops: [{ op: 'metadata', patch: { name: 'Other' } }] };
        const applied = editorReducer(staged, { type: 'applyChangeSet', changeSet: other });
        expect(applied.proposal?.stale).toBe(true);
        expect(outcomes(applied)).toEqual(['cs-1:stale']);
    });
});
