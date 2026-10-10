import { describe, it, expect } from 'vitest';
import { buildFlowContext, menuTarget } from './flowContext.ts';
import { createEditorState, editorReducer } from '../hooks/editorState.ts';
import type { Workflow } from '../types/workflow.ts';

const workflow = (): Workflow => ({ id: 'w', name: 'W', nodes: [
    { id: 's', type: 'start', name: 'S', config: {}, position: { x: 0, y: 0 } },
    { id: 'e', type: 'end', name: 'E', config: {}, position: { x: 300, y: 0 } },
], edges: [{ id: 'se', source: 's', target: 'e', priority: 0, isDefault: false }] });

describe('menuTarget', () => {
    it('returns the clicked element when it is not part of a multi-selection', () => {
        expect(menuTarget({ kind: 'node', nodeId: 's' }, { nodeIds: ['s'], edgeIds: [] }))
            .toEqual({ kind: 'node', nodeId: 's' });
        expect(menuTarget({ kind: 'edge', edgeId: 'se' }, { nodeIds: ['s', 'e'], edgeIds: [] }))
            .toEqual({ kind: 'edge', edgeId: 'se' });
    });

    it('returns the whole selection when the clicked element is inside a selection of two or more', () => {
        expect(menuTarget({ kind: 'node', nodeId: 'e' }, { nodeIds: ['e', 's'], edgeIds: [] }))
            .toEqual({ kind: 'selection', nodeIds: ['e', 's'], edgeIds: [] });
        expect(menuTarget({ kind: 'edge', edgeId: 'se' }, { nodeIds: ['s'], edgeIds: ['se'] }))
            .toEqual({ kind: 'selection', nodeIds: ['s'], edgeIds: ['se'] });
    });

    it('passes canvas and problem subjects through as copies', () => {
        const canvas = { kind: 'canvas' as const, flowPosition: { x: 1, y: 2 } };
        const result = menuTarget(canvas, { nodeIds: ['s', 'e'], edgeIds: [] });
        expect(result).toEqual(canvas);
        expect(result).not.toBe(canvas);
        const problem = { kind: 'problem' as const, problem: { severity: 'error' as const, code: 'X', message: 'm' } };
        const problemTarget = menuTarget(problem, { nodeIds: [], edgeIds: [] });
        expect(problemTarget).toEqual(problem);
        expect(problemTarget).not.toBe(problem);
    });
});

describe('buildFlowContext', () => {
    it('builds a detached snapshot with revision, sorted selection and problems', () => {
        const state = editorReducer(createEditorState(workflow()), { type: 'select', nodeId: 's' });
        const problems = [{ severity: 'warning' as const, code: 'W', message: 'm', nodeId: 's' }];
        const context = buildFlowContext(state, { kind: 'node', nodeId: 's' }, problems, true, { x: 10, y: 20 });
        expect(context).toEqual({ target: { kind: 'node', nodeId: 's' }, workflow: state.document,
            contentRevision: state.contentRevision, selection: { nodeIds: ['s'], edgeIds: [] }, problems,
            readOnly: true, screenPosition: { x: 10, y: 20 } });
        context.workflow.nodes.length = 0;
        context.problems.length = 0;
        expect(state.document.nodes).toHaveLength(2);
        expect(problems).toHaveLength(1);
    });
});
