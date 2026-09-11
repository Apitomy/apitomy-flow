import { describe, it, expect } from 'vitest';
import { type Workflow, type WorkflowNode, type WorkflowEdge } from '../types/workflow.ts';
import { analyzeParallelRegions } from './parallelRegions.ts';

function node(id: string, type: WorkflowNode['type']): WorkflowNode {
    return { id, type, name: id, config: {}, position: { x: 0, y: 0 } };
}
function edge(id: string, source: string, target: string, extra: Partial<WorkflowEdge> = {}): WorkflowEdge {
    return { id, source, target, priority: 0, isDefault: false, ...extra };
}
function workflow(nodes: WorkflowNode[], edges: WorkflowEdge[]): Workflow {
    return { id: 'wf', name: 'wf', nodes, edges };
}

/** start -> f(fork) -> a, b ; a -> j, b -> j ; j -> end */
function forkJoin(): Workflow {
    return workflow(
        [node('start', 'start'), node('f', 'wait'), node('a', 'action'), node('b', 'action'),
            node('j', 'wait'), node('end', 'end')],
        [edge('s', 'start', 'f'), edge('fa', 'f', 'a'), edge('fb', 'f', 'b'),
            edge('aj', 'a', 'j'), edge('bj', 'b', 'j'), edge('je', 'j', 'end')],
    );
}

describe('analyzeParallelRegions', () => {
    it('classifies a fork and its matching join', () => {
        const r = analyzeParallelRegions(forkJoin());
        expect(r.isFork('f')).toBe(true);
        expect(r.isJoin('j')).toBe(true);
        expect(r.joinFor('f')).toBe('j');
        expect(r.problems).toEqual([]);
    });

    it('reports every incoming edge of the join', () => {
        const r = analyzeParallelRegions(forkJoin());
        expect(r.incomingEdgeIds('j')).toEqual(new Set(['aj', 'bj']));
    });

    it('returns a fresh incoming-edge set each call (no shared mutable state)', () => {
        const r = analyzeParallelRegions(forkJoin());
        const first = r.incomingEdgeIds('j');
        first.add('mutated');
        expect(r.incomingEdgeIds('j')).toEqual(new Set(['aj', 'bj']));
    });

    it('does not treat an exclusive choice as a fork', () => {
        const w = workflow(
            [node('start', 'start'), node('a', 'end'), node('b', 'end')],
            [edge('ea', 'start', 'a', { condition: 'context.x == 1' }),
                edge('eb', 'start', 'b', { isDefault: true })],
        );
        const r = analyzeParallelRegions(w);
        expect(r.isFork('start')).toBe(false);
        expect(r.problems).toEqual([]);
    });

    it('reports MIXED_FORK_EDGES when unconditional and conditional edges are mixed', () => {
        const w = workflow(
            [node('start', 'start'), node('a', 'end'), node('b', 'end')],
            [edge('ea', 'start', 'a'), edge('eb', 'start', 'b', { condition: 'context.x == 1' })],
        );
        const r = analyzeParallelRegions(w);
        expect(r.isFork('start')).toBe(false);
        expect(r.problems).toContainEqual({ code: 'MIXED_FORK_EDGES', nodeId: 'start' });
    });

    it('reports FORK_WITHOUT_JOIN when branches never re-converge', () => {
        const w = workflow(
            [node('start', 'start'), node('a', 'action'), node('b', 'action'),
                node('ea', 'end'), node('eb', 'end')],
            [edge('fa', 'start', 'a'), edge('fb', 'start', 'b'),
                edge('ae', 'a', 'ea'), edge('be', 'b', 'eb')],
        );
        const r = analyzeParallelRegions(w);
        // both branches reach an END without a common convergence node
        expect(r.problems.some(p => p.nodeId === 'start'
            && (p.code === 'FORK_WITHOUT_JOIN' || p.code === 'PARALLEL_BRANCH_REACHES_END'))).toBe(true);
    });

    it('reports PARALLEL_BRANCH_REACHES_END when a branch reaches END without re-converging', () => {
        // start forks to a and b; a -> j -> end1, b -> end2 (separate ends; branches never re-converge)
        const w = workflow(
            [node('start', 'start'), node('a', 'action'), node('b', 'action'),
                node('j', 'wait'), node('end1', 'end'), node('end2', 'end')],
            [edge('fa', 'start', 'a'), edge('fb', 'start', 'b'),
                edge('aj', 'a', 'j'), edge('be', 'b', 'end2'), edge('je', 'j', 'end1')],
        );
        const r = analyzeParallelRegions(w);
        expect(r.problems.some(p => p.nodeId === 'start' && p.code === 'PARALLEL_BRANCH_REACHES_END'))
            .toBe(true);
    });

    it('finds correct join when fork edges are declared in reverse priority order', () => {
        // Diamond: start -> fork -> a, b -> join -> end
        // Fork edges declared in reverse priority (b before a in array, but a has priority 0)
        const w = workflow(
            [node('start', 'start'), node('fork', 'wait'), node('a', 'action'),
                node('b', 'action'), node('join', 'wait'), node('end', 'end')],
            [edge('s', 'start', 'fork'),
                edge('fb', 'fork', 'b', { priority: 1 }),
                edge('fa', 'fork', 'a', { priority: 0 }),
                edge('aj', 'a', 'join'), edge('bj', 'b', 'join'),
                edge('je', 'join', 'end')],
        );
        const r = analyzeParallelRegions(w);
        expect(r.joinFor('fork')).toBe('join');
        expect(r.problems).toEqual([]);
    });
});
