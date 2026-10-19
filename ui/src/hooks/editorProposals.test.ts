import { describe, it, expect } from 'vitest';
import { createEditorState, editorReducer, type EditorState } from './editorState.ts';
import { applyChangeSetChecked } from '../changeset/applyChangeSet.ts';
import { layoutAppliedChange } from '../changeset/appliedLayout.ts';
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

    const flags = (state: EditorState) => ({
        nodes: state.nodes.filter(node => node.selected).map(node => node.id).sort(),
        edges: state.edges.filter(edge => edge.selected).map(edge => edge.id).sort(),
        primary: [state.selectedNodeId, state.selectedEdgeId],
    });
    const selectA = (state: EditorState) => editorReducer(editorReducer(state, { type: 'select', nodeId: 'a' }),
        { type: 'nodesChange', changes: [{ type: 'select', id: 'a', selected: true }] });

    it('selects added and modified elements, replacing the prior selection, with no primary for many', () => {
        const initial = selectA(createEditorState(workflow()));
        const applied = editorReducer(initial, { type: 'applyChangeSet', changeSet: addWait(initial) });
        expect(flags(applied)).toEqual({ nodes: ['w'], edges: ['aw', 'we'], primary: [null, null] });
        expect('highlight' in applied).toBe(false);
    });

    it('makes a single applied element the primary selection', () => {
        const initial = createEditorState(workflow());
        const changeSet: ChangeSet = { id: 'r', baseRevision: initial.contentRevision, author: 'agent:test', summary: 's',
            ops: [{ op: 'updateNode', id: 'e', patch: { name: 'End' } }] };
        const applied = editorReducer(initial, { type: 'applyChangeSet', changeSet });
        expect(flags(applied)).toEqual({ nodes: ['e'], edges: [], primary: ['e', null] });
    });

    it('clears the selection for a remove-only change set', () => {
        const initial = selectA(createEditorState(workflow()));
        const changeSet: ChangeSet = { id: 'r', baseRevision: initial.contentRevision, author: 'agent:test', summary: 's',
            ops: [{ op: 'removeEdge', id: 'ae' }] };
        const applied = editorReducer(initial, { type: 'applyChangeSet', changeSet });
        expect(flags(applied)).toEqual({ nodes: [], edges: [], primary: [null, null] });
    });

    it('leaves the selection alone when selecting applied changes is disabled', () => {
        const initial = selectA(createEditorState(workflow()));
        const applied = editorReducer(initial,
            { type: 'applyChangeSet', changeSet: addWait(initial), selectApplied: false });
        expect(flags(applied)).toEqual({ nodes: ['a'], edges: [], primary: ['a', null] });
    });

    it('undo restores the prior selection and redo re-selects the applied changes', () => {
        const initial = selectA(createEditorState(workflow()));
        const applied = editorReducer(initial, { type: 'applyChangeSet', changeSet: addWait(initial) });
        const undone = editorReducer(applied, { type: 'undo' });
        expect(flags(undone)).toEqual({ nodes: ['a'], edges: [], primary: ['a', null] });
        const redone = editorReducer(undone, { type: 'redo' });
        expect(flags(redone)).toEqual({ nodes: ['w'], edges: ['aw', 'we'], primary: [null, null] });
    });

    it('clearHighlights clears the selection', () => {
        const initial = createEditorState(workflow());
        const applied = editorReducer(initial, { type: 'applyChangeSet', changeSet: addWait(initial) });
        expect(flags(editorReducer(applied, { type: 'clearHighlights' })))
            .toEqual({ nodes: [], edges: [], primary: [null, null] });
    });

    it('selects the changes of an accepted proposal unless disabled', () => {
        const initial = selectA(createEditorState(workflow()));
        const staged = propose(initial, addWait(initial));
        expect(flags(editorReducer(staged, { type: 'acceptProposal' })))
            .toEqual({ nodes: ['w'], edges: ['aw', 'we'], primary: [null, null] });
        expect(flags(editorReducer(staged, { type: 'acceptProposal', selectApplied: false })))
            .toEqual({ nodes: ['a'], edges: [], primary: ['a', null] });
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

describe('applied change layout', () => {
    const positions = (state: EditorState) => Object.fromEntries(state.document.nodes.map(node => [node.id, node.position]));

    it('accepting commits exactly the previewed layout, content and tidy in one undo step', () => {
        const initial = createEditorState(workflow());
        const changeSet = addWait(initial);
        const checked = applyChangeSetChecked(initial.document, changeSet, initial.contentRevision);
        if (!checked.ok) throw new Error(checked.error.reason);
        const preview = layoutAppliedChange(checked.workflow, changeSet, 'tidy');
        const staged = editorReducer(initial, { type: 'propose', changeSet, preview });
        const accepted = editorReducer(staged, { type: 'acceptProposal' });
        expect(positions(accepted)).toEqual(Object.fromEntries(preview.nodes.map(node => [node.id, node.position])));
        expect(accepted.past).toHaveLength(initial.past.length + 1);
        const undone = editorReducer(accepted, { type: 'undo' });
        expect(positions(undone)).toEqual(positions(initial));
    });

    it("apply with layout 'tidy' re-lays out structural changes as one undo step", () => {
        const initial = createEditorState(workflow());
        const placed = editorReducer(initial, { type: 'applyChangeSet', changeSet: addWait(initial) });
        const tidied = editorReducer(initial, { type: 'applyChangeSet', changeSet: addWait(initial), layout: 'tidy' });
        expect(positions(tidied)).not.toEqual(positions(placed));
        expect(positions(tidied).s).not.toEqual(positions(initial).s);
        expect(tidied.contentRevision).toBe(placed.contentRevision);
        expect(tidied.past).toHaveLength(initial.past.length + 1);
    });

    it("apply with layout 'tidy' leaves the layout alone for a rename", () => {
        const initial = createEditorState(workflow());
        const rename: ChangeSet = { id: 'r', baseRevision: initial.contentRevision, author: 'agent:test', summary: 'r',
            ops: [{ op: 'updateNode', id: 'a', patch: { name: 'Renamed' } }] };
        expect(positions(editorReducer(initial, { type: 'applyChangeSet', changeSet: rename, layout: 'tidy' })))
            .toEqual(positions(initial));
    });
});

describe('change sets while simulating (#192)', () => {
    const simulating = () => editorReducer(createEditorState(workflow()), { type: 'mode', simulating: true });

    it('apply exits simulation, then applies the change set', () => {
        const state = simulating();
        const applied = editorReducer(state, { type: 'applyChangeSet', changeSet: addWait(state) });
        expect(applied.simulating).toBe(false);
        expect(applied.document.nodes.map(node => node.id)).toContain('w');
        expect(applied.past).toHaveLength(state.past.length + 1);
    });

    it('propose exits simulation, then stages the proposal', () => {
        const staged = propose(simulating(), addWait(simulating()));
        expect(staged.simulating).toBe(false);
        expect(staged.proposal?.stale).toBe(false);
    });

    it('accepting a staged proposal while simulating exits simulation first', () => {
        const initial = createEditorState(workflow());
        const staged = editorReducer(propose(initial, addWait(initial)), { type: 'mode', simulating: true });
        const accepted = editorReducer(staged, { type: 'acceptProposal' });
        expect(accepted.simulating).toBe(false);
        expect(accepted.document.nodes.map(node => node.id)).toContain('w');
        expect(outcomes(accepted)).toEqual(['cs-1:accepted']);
    });

    it('keeps simulating when the change set is stale', () => {
        const state = simulating();
        const stale = { ...addWait(state), baseRevision: 'sha256:old' };
        expect(editorReducer(state, { type: 'applyChangeSet', changeSet: stale })).toBe(state);
        expect(editorReducer(state, { type: 'propose', changeSet: stale, preview: state.document })).toBe(state);
    });
});
