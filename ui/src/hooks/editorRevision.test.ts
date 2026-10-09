import { describe, it, expect, vi } from 'vitest';
import { createEditorState, editorReducer } from './editorState.ts';
import { createDocumentPublisher } from './editorNotifications.ts';
import { computeContentRevision } from '../changeset/contentRevision.ts';
import type { Workflow } from '../types/workflow.ts';

const workflow = (): Workflow => ({ id: 'w', name: 'W', nodes: [
    { id: 's', type: 'start', name: 'S', config: {}, position: { x: 0, y: 0 } },
    { id: 'a', type: 'action', name: 'A', config: {}, position: { x: 200, y: 0 } },
], edges: [{ id: 'sa', source: 's', target: 'a', priority: 0, isDefault: false }] });

describe('content revision', () => {
    it('starts at the hash of the seeded workflow', () => {
        expect(createEditorState(workflow()).contentRevision).toBe(computeContentRevision(workflow()));
    });

    it('ignores layout-only edits, changes on content edits and is restored by undo', () => {
        const initial = createEditorState(workflow());
        const moved = editorReducer(editorReducer(initial, { type: 'positions', positions: { a: { x: 999, y: 7 } } }),
            { type: 'commitPositions' });
        expect(moved.contentRevision).toBe(initial.contentRevision);
        const renamed = editorReducer(moved, { type: 'nodeData', id: 'a', data: { name: 'Renamed' } });
        expect(renamed.contentRevision).not.toBe(initial.contentRevision);
        expect(editorReducer(renamed, { type: 'undo' }).contentRevision).toBe(initial.contentRevision);
    });
});

describe('origin', () => {
    it('defaults to user, records import origin, uses host for metadata and user for undo', () => {
        const initial = createEditorState(workflow());
        expect(initial.origin).toBe('user');
        const imported = editorReducer(initial, { type: 'import', workflow: { ...workflow(), name: 'Agent' }, origin: 'agent:x' });
        expect(imported.origin).toBe('agent:x');
        expect(editorReducer(imported, { type: 'undo' }).origin).toBe('user');
        const meta = editorReducer(initial, { type: 'metadata', metadata: { id: 'w', name: 'Host name' } });
        expect(meta.origin).toBe('host');
    });

    it('publishes contentRevision and origin with onChange', () => {
        const onChange = vi.fn();
        const state = editorReducer(createEditorState(workflow()), { type: 'nodeData', id: 'a', data: { name: 'New' } });
        createDocumentPublisher()(state, onChange);
        expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ id: 'w' }),
            { contentRevision: state.contentRevision, origin: 'user' });
    });
});
