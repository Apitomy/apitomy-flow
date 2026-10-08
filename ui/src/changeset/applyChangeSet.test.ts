import { describe, it, expect } from 'vitest';
import { applyChangeSet, applyChangeSetChecked } from './applyChangeSet.ts';
import { computeContentRevision } from './contentRevision.ts';
import type { ChangeSet } from './types.ts';
import type { Workflow } from '../types/workflow.ts';

const workflow = (): Workflow => ({ id: 'w', name: 'W',
    nodes: [{ id: 's', type: 'start', name: 'S', config: {}, position: { x: 0, y: 0 } }], edges: [] });
const changeSet = (ops: ChangeSet['ops'], baseRevision = ''): ChangeSet =>
    ({ id: 'cs', baseRevision, author: 'agent:test', summary: 'test', ops });

describe('applyChangeSet', () => {
    it('does not mutate its input', () => {
        const input = workflow();
        applyChangeSet(input, changeSet([{ op: 'removeNode', id: 's' }]));
        expect(input.nodes).toHaveLength(1);
    });

    it('places added nodes next to positioned neighbours', () => {
        const result = applyChangeSet(workflow(), changeSet([
            { op: 'addNode', node: { id: 'e', type: 'end', name: 'E', config: {} } },
            { op: 'addEdge', edge: { id: 'se', source: 's', target: 'e', priority: 0, isDefault: false } },
        ]));
        expect(result.ok && result.workflow.nodes[1].position).toEqual({ x: 120 + 90, y: 0 });
    });

    it('rejects a change set without ops as malformed with no opIndex', () => {
        const result = applyChangeSet(workflow(), { id: 'x' } as unknown as ChangeSet);
        expect(result).toEqual({ ok: false, error: { code: 'malformed', reason: expect.any(String) } });
    });

    it('reports a human-readable reason', () => {
        const result = applyChangeSet(workflow(), changeSet([{ op: 'removeNode', id: 'nope' }]));
        expect(!result.ok && result.error.reason).toContain('nope');
    });
});

describe('applyChangeSetChecked', () => {
    it('applies when the base revision matches and rejects as stale otherwise', () => {
        const input = workflow();
        const ops: ChangeSet['ops'] = [{ op: 'metadata', patch: { name: 'Renamed' } }];
        expect(applyChangeSetChecked(input, changeSet(ops, computeContentRevision(input))).ok).toBe(true);
        const stale = applyChangeSetChecked(input, changeSet(ops, 'sha256:old'));
        expect(!stale.ok && stale.error.code).toBe('stale');
        expect(!stale.ok && stale.error.opIndex).toBeUndefined();
    });
});
