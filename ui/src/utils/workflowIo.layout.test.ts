import { afterEach, describe, expect, it, vi } from 'vitest';
import dagre from '@dagrejs/dagre';
import { parseWorkflow } from './workflowIo.ts';

const text = JSON.stringify({
    id: 'w', name: 'Workflow',
    nodes: [{ id: 's', type: 'start' }, { id: 'e', type: 'end' }],
    edges: [{ id: 'se', source: 's', target: 'e' }],
});

describe('import layout failure boundary', () => {
    afterEach(() => vi.restoreAllMocks());

    it.each(['exception', 'nonfinite'] as const)('reports %s layout failure as a structured problem', failure => {
        // Inject dependency failure, exercising real normalization, layout adapter, and import handling.
        vi.spyOn(dagre, 'layout').mockImplementation(graph => {
            if (failure === 'exception') throw new Error('Layout failed');
            for (const id of graph.nodes()) {
                graph.setNode(id, { x: NaN, y: Infinity });
            }
            return graph;
        });
        const result = parseWorkflow(text);
        expect(result.workflow).toBeUndefined();
        expect(result.error).toBeDefined();
        expect(result.problems).toEqual(expect.arrayContaining([
            expect.objectContaining({ code: 'LAYOUT_FAILED', severity: 'error' }),
        ]));
    });
});
