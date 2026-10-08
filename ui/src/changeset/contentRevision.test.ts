import { describe, it, expect } from 'vitest';
import vectors from '../../../conformance/content-revision.json';
import { canonicalJson } from './canonicalJson.ts';
import { computeContentRevision, stripLayout } from './contentRevision.ts';
import type { Workflow } from '../types/workflow.ts';

describe('shared content revision vectors', () => {
    for (const vector of vectors as { name: string; revision: string; workflow: unknown }[]) {
        it(vector.name, () => {
            expect(computeContentRevision(vector.workflow as Workflow)).toBe(vector.revision);
        });
    }
});

describe('canonicalJson', () => {
    it('sorts keys, drops undefined properties and keeps array order', () => {
        expect(canonicalJson({ b: 1, a: [3, 1], c: undefined })).toBe('{"a":[3,1],"b":1}');
    });

    it('rejects non-finite numbers', () => {
        expect(() => canonicalJson({ n: Number.NaN })).toThrow(TypeError);
    });
});

describe('stripLayout', () => {
    it('removes node positions without mutating the input', () => {
        const workflow: Workflow = { id: 'w', name: 'W', edges: [],
            nodes: [{ id: 's', type: 'start', name: 'S', config: {}, position: { x: 1, y: 2 } }] };
        expect(stripLayout(workflow).nodes[0]).not.toHaveProperty('position');
        expect(workflow.nodes[0].position).toEqual({ x: 1, y: 2 });
    });
});
