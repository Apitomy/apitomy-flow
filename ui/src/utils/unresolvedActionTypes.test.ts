import { describe, it, expect } from 'vitest';
import { unresolvedActionTypeIds } from './unresolvedActionTypes.ts';
import type { Workflow } from '../types/workflow.ts';

const workflow: Workflow = { id: 'w', name: 'W', edges: [], nodes: [
    { id: 'known', type: 'action', name: 'K', config: { actionType: 'http' } },
    { id: 'unknown', type: 'action', name: 'U', config: { actionType: 'slack.notify' } },
    { id: 'blank', type: 'action', name: 'B', config: { actionType: '  ' } },
    { id: 'missing', type: 'action', name: 'M', config: {} },
    { id: 'weird', type: 'action', name: 'X', config: { actionType: 5 as unknown as string } },
    { id: 'wait', type: 'wait', name: 'W', config: { duration: 'PT1M' } },
] };
const catalog = [{ value: 'http', label: 'HTTP' }];

describe('unresolvedActionTypeIds', () => {
    it('flags only non-blank string action types missing from a ready catalog', () => {
        expect(unresolvedActionTypeIds(workflow, { actionTypes: catalog, status: 'ready' })).toEqual(new Set(['unknown']));
    });

    it('flags nothing while the catalog is absent or loading', () => {
        expect(unresolvedActionTypeIds(workflow, { actionTypes: [], status: 'none' }).size).toBe(0);
        expect(unresolvedActionTypeIds(workflow, { actionTypes: [], status: 'loading' }).size).toBe(0);
    });

    it('flags every referenced type against an empty ready catalog', () => {
        expect(unresolvedActionTypeIds(workflow, { actionTypes: [], status: 'ready' })).toEqual(new Set(['known', 'unknown']));
    });
});
