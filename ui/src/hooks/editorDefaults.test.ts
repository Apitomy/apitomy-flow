import { describe, expect, it } from 'vitest';
import { createEditorState, editorReducer } from './editorState.ts';
import { readOnlyCommand } from './editorReadOnly.ts';
import { type Workflow } from '../types/workflow.ts';

const workflow: Workflow = { id: 'w', name: 'W', nodes: [
    { id: 's', name: 's', type: 'start', config: { inputs: [] }, position: { x: 0, y: 0 } }], edges: [] };

describe('workflow defaults command', () => {
    it('sets, undoes, and clears workflow defaults', () => {
        let state = createEditorState(workflow);
        state = editorReducer(state, { type: 'defaults', defaults: { retry: { maxAttempts: 3 } } });
        expect(state.document.defaults).toEqual({ retry: { maxAttempts: 3 } });
        state = editorReducer(state, { type: 'undo' });
        expect(state.document.defaults).toBeUndefined();
        state = editorReducer(state, { type: 'redo' });
        state = editorReducer(state, { type: 'defaults', defaults: undefined });
        expect('defaults' in state.document).toBe(false);
    });

    it('is blocked in read-only mode', () => {
        expect(readOnlyCommand({ type: 'defaults', defaults: { retry: { maxAttempts: 2 } } })).toBeNull();
    });
});
