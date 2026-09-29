import { describe, expect, it } from 'vitest';
import { deleteWithEditorFocus } from './editorDeletion.ts';
import { createEditorState, editorReducer } from './editorState.ts';
import { editorShortcut } from './editorShortcuts.ts';
import type { Workflow } from '../types/workflow.ts';

const workflow: Workflow = { id: 'test', name: 'Test', nodes: [
    { id: 'node', type: 'start', name: 'Start', config: {}, position: { x: 0, y: 0 } },
], edges: [{ id: 'edge', source: 'node', target: 'node', priority: 0, isDefault: false }] };

describe('deletion focus handoff', () => {
    it.each([{ nodeIds: ['node'] }, { edgeIds: ['edge'] }])(
        'hands off before removal, enabling immediate scoped undo and redo: %j', (selection) => {
            let state = createEditorState(workflow);
            const other = createEditorState(workflow);
            let focus = 'graph';
            deleteWithEditorFocus(state, { type: 'delete', ...selection }, {
                focus: options => {
                    expect(options.preventScroll).toBe(true);
                    expect(state.document).toEqual(workflow); // handoff must precede removal
                    focus = 'root';
                },
            }, command => {
                state = editorReducer(state, command);
                if (focus === 'graph') focus = 'outside'; // removed focused element loses ownership
            });
            expect(state.document.edges).toEqual([]);
            const undo = editorShortcut({ key: 'z', ctrlKey: true }, focus === 'root', false, false);
            expect(undo).toBe('undo');
            state = editorReducer(state, { type: 'undo' });
            expect(state.document).toEqual(workflow);
            expect(editorShortcut({ key: 'z', ctrlKey: true, shiftKey: true }, focus === 'root', false, false)).toBe('redo');
            expect(editorReducer(state, { type: 'redo' }).document.edges).toEqual([]);
            expect(other.document).toEqual(workflow);
        },
    );

    it('does not steal focus or dispatch when deletion is locked or empty', () => {
        const initial = createEditorState(workflow);
        for (const state of [initial, editorReducer(initial, { type: 'mode', simulating: true }),
            editorReducer(initial, { type: 'mode', interactive: false })]) {
            let touched = false;
            deleteWithEditorFocus(state, { type: 'delete', nodeIds: state === initial ? [] : ['node'] },
                { focus: () => { touched = true; } }, () => { touched = true; });
            expect(touched).toBe(false);
        }
    });
});
