import { describe, expect, it } from 'vitest';
import { createMapDraft, editMapDraft, syncMapDraft } from './mapInputDraft.ts';
import { createEditorState, editorReducer } from '../hooks/editorState.ts';
import type { Workflow } from '../types/workflow.ts';

const workflow: Workflow = { id: 'drafts', name: 'Drafts', nodes: [
    { id: 'a', name: 'A', type: 'human-task', position: { x: 0, y: 0 }, config: { inputs: { a: 'one', b: 'two' } } },
    { id: 'b', name: 'B', type: 'human-task', position: { x: 200, y: 0 }, config: { inputs: { a: 'one', b: 'two' } } },
], edges: [] };

describe('map input draft protocol', () => {
    it('resets on an identical import without adding history, but retains drafts on node rename', () => {
        let editor = createEditorState(workflow);
        let draft = createMapDraft({ a: 'one' }, `${editor.nodeKeys.a}:${editor.draftReset}`);
        draft = editMapDraft(draft, [...draft.pairs, { id: 'duplicate', key: 'a', value: 'one' }]);
        editor = editorReducer(editor, { type: 'renameNode', id: 'a', newId: 'renamed' });
        expect(syncMapDraft(draft, { a: 'one' }, `${editor.nodeKeys.renamed}:${editor.draftReset}`)).toBe(draft);
        const revision = editor.revision;
        const past = editor.past;
        editor = editorReducer(editor, { type: 'import', workflow: editor.document });
        expect(editor.revision).toBe(revision);
        expect(editor.past).toBe(past);
        expect(syncMapDraft(draft, { a: 'one' }, `${editor.nodeKeys.renamed}:${editor.draftReset}`).pairs).toHaveLength(1);
    });

    it('retains row keys and duplicate/empty drafts through cloned echoes and unrelated commits', () => {
        let editor = createEditorState(workflow);
        let draft = createMapDraft(editor.document.nodes[0].config.inputs, 'a:0');
        const ids = draft.pairs.map(pair => pair.id);
        for (const key of ['b', '', 'renamed']) {
            draft = editMapDraft(draft, draft.pairs.map((pair, index) => index === 0 ? { ...pair, key } : pair));
            editor = editorReducer(editor, { type: 'nodeData', id: 'a', data: { config: { inputs: draft.map } } });
            draft = syncMapDraft(draft, editor.document.nodes[0].config.inputs, 'a:0');
            expect(draft.pairs.map(pair => pair.id)).toEqual(ids);
            expect(draft.pairs.map(pair => pair.key)).toEqual([key, 'b']);
            editor = editorReducer(editor, { type: 'nodeData', id: 'b', data: { name: 'Unrelated' } });
            expect(syncMapDraft(draft, editor.document.nodes[0].config.inputs, 'a:0')).toBe(draft);
        }
    });

    it('resets equal serialized duplicate drafts on undo, redo, import and selection transitions', () => {
        let editor = editorReducer(createEditorState(workflow), { type: 'select', nodeId: 'a' });
        const identity = () => `${editor.nodeKeys[editor.selectedNodeId ?? 'a']}:${editor.draftReset}`;
        let draft = createMapDraft({ a: 'one' }, identity());
        draft = editMapDraft(draft, [...draft.pairs, { id: 'duplicate', key: 'a', value: 'one' }]);
        const originalReset = editor.draftReset;
        editor = editorReducer(editor, { type: 'nodeData', id: 'a', data: { name: 'Changed' } });
        expect(editor.draftReset).toBe(originalReset);
        for (const command of [{ type: 'undo' }, { type: 'redo' }, { type: 'import', workflow },
            { type: 'select', nodeId: 'b' }, { type: 'select', nodeId: 'a' }] as const) {
            const beforeReset = editor.draftReset;
            editor = editorReducer(editor, command);
            expect(editor.draftReset).toBeGreaterThan(beforeReset);
            const next = syncMapDraft(draft, { a: 'one' }, identity());
            expect(next.pairs).toHaveLength(1);
            expect(next.pairs[0].id).not.toBe(draft.pairs[0].id);
            draft = editMapDraft(next, [...next.pairs, { id: 'duplicate', key: 'a', value: 'one' }]);
        }
    });

    it('accepts unequal external maps, but ignores object order and preserves untouched literal values', () => {
        let draft = createMapDraft({ count: 12, enabled: false, nested: { a: 1, b: [null, true] } }, 'a');
        expect(syncMapDraft(draft, { nested: { b: [null, true], a: 1 }, enabled: false, count: 12 }, 'a')).toBe(draft);
        draft = editMapDraft(draft, draft.pairs.map(pair => pair.key === 'count' ? { ...pair, key: 'total' } : pair));
        expect(draft.map).toEqual({ total: 12, enabled: false, nested: { a: 1, b: [null, true] } });
        expect(syncMapDraft(draft, structuredClone(draft.map), 'a')).toBe(draft);
        const external = syncMapDraft(draft, { total: 13 }, 'a');
        expect(external.pairs.map(({ key, value }) => ({ key, value }))).toEqual([{ key: 'total', value: 13 }]);
    });

    it('keeps row identities when a non-last row is removed and safely serializes special keys', () => {
        let draft = createMapDraft({ a: 'one', b: 'two' }, 'a');
        const secondId = draft.pairs[1].id;
        draft = editMapDraft(draft, [{ ...draft.pairs[1], key: '__proto__' }]);
        expect(Object.keys(draft.map)).toEqual(['__proto__']);
        expect(syncMapDraft(draft, structuredClone(draft.map), 'a').pairs[0].id).toBe(secondId);
    });
});
