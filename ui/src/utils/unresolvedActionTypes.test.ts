import { describe, it, expect } from 'vitest';
import { isUnresolvedActionType, unresolvedActionTypeIds } from './unresolvedActionTypes.ts';
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

describe('isUnresolvedActionType', () => {
    const ready = { actionTypes: catalog, status: 'ready' as const };

    it('flags a non-blank string missing from a ready catalog', () => {
        expect(isUnresolvedActionType('slack.notify', ready)).toBe(true);
        expect(isUnresolvedActionType('http', ready)).toBe(false);
        expect(isUnresolvedActionType('  ', ready)).toBe(false);
    });

    it('never flags or throws on non-string values', () => {
        for (const value of [5, null, undefined, {}, ['x'], true]) {
            expect(isUnresolvedActionType(value, ready)).toBe(false);
        }
    });

    it('flags nothing unless the catalog is ready', () => {
        expect(isUnresolvedActionType('slack.notify', { actionTypes: [], status: 'loading' })).toBe(false);
        expect(isUnresolvedActionType('slack.notify', { actionTypes: [], status: 'none' })).toBe(false);
    });
});
