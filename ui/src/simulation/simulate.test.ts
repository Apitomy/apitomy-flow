import { describe, it, expect } from 'vitest';
import { type Workflow, type WorkflowNode, type WorkflowEdge } from '../types/workflow.ts';
import { cveTriage } from '../dev/sampleWorkflows.ts';
import {
    startSimulation,
    stepSimulation,
    runSimulation,
    resumeSimulation,
    MAX_TRANSITIONS,
    type SimState,
} from './simulate.ts';

/**
 * Behavioral tests for the routing simulator. These pin the simulator to the Java engine's
 * routing rules (priority-ordered edge selection, default fallback, no-match failure, loop guard)
 * and exercise the block/resume lifecycle at action / human-task / receive-event nodes.
 */

function node(id: string, type: WorkflowNode['type'], config: Record<string, unknown> = {}): WorkflowNode {
    return { id, type, name: id, config, position: { x: 0, y: 0 } };
}

function edge(id: string, source: string, target: string, extra: Partial<WorkflowEdge> = {}): WorkflowEdge {
    return { id, source, target, priority: 0, isDefault: false, ...extra };
}

function workflow(nodes: WorkflowNode[], edges: WorkflowEdge[]): Workflow {
    return { id: 'wf', name: 'wf', nodes, edges };
}

/** Runs a simulation to a terminal/blocked state, supplying the given mocks in order at blocks. */
function runWithMocks(wf: Workflow, context: Record<string, unknown>, outputs: Record<string, unknown>[]): SimState {
    let state = startSimulation(wf, context);
    let i = 0;
    for (let guard = 0; guard < 1000; guard++) {
        state = runSimulation(wf, state);
        if (state.status !== 'blocked') break;
        state = resumeSimulation(wf, state, { output: outputs[i++] ?? {} });
    }
    return state;
}

describe('startSimulation', () => {
    it('positions at the start node, ready to route', () => {
        const wf = workflow([node('start', 'start'), node('end', 'end')], [edge('e1', 'start', 'end')]);
        const state = startSimulation(wf, { foo: 'bar' });
        expect(state.status).toBe('running');
        expect(state.currentNodeId).toBe('start');
        expect(state.visitedNodeIds).toEqual(['start']);
        expect(state.context).toEqual({ foo: 'bar' });
    });

    it('fails immediately when there is no start node', () => {
        const wf = workflow([node('end', 'end')], []);
        const state = startSimulation(wf, {});
        expect(state.status).toBe('failed');
        expect(state.error?.message).toContain('No start node');
    });
});

describe('edge selection — parity with WorkflowEngine.selectEdge', () => {
    it('chooses the lowest-priority matching conditional edge', () => {
        const wf = workflow(
            [node('start', 'start'), node('a', 'end'), node('b', 'end')],
            [
                edge('high', 'start', 'a', { priority: 2, condition: 'context.x == 1' }),
                edge('low', 'start', 'b', { priority: 1, condition: 'context.x == 1' }),
            ],
        );
        const state = stepSimulation(wf, startSimulation(wf, { x: 1 }));
        expect(state.currentNodeId).toBe('b'); // priority 1 wins over priority 2
        expect(state.edgeEvaluations['low'].result).toBe('matched');
        // The higher-priority edge is evaluated first is false? No: 'low' (priority 1) is first.
        expect(state.edgeEvaluations['high'].result).toBe('skipped');
    });

    it('falls back to the default edge when no condition matches', () => {
        const wf = workflow(
            [node('start', 'start'), node('a', 'end'), node('b', 'end')],
            [
                edge('cond', 'start', 'a', { priority: 1, condition: 'context.x == 99' }),
                edge('def', 'start', 'b', { priority: 2, isDefault: true }),
            ],
        );
        const state = stepSimulation(wf, startSimulation(wf, { x: 1 }));
        expect(state.currentNodeId).toBe('b');
        expect(state.edgeEvaluations['cond'].result).toBe('false');
        expect(state.edgeEvaluations['def'].result).toBe('matched');
    });

    it('fails when no edge matches and there is no default', () => {
        const wf = workflow(
            [node('start', 'start'), node('a', 'end')],
            [edge('cond', 'start', 'a', { condition: 'context.x == 99' })],
        );
        const state = stepSimulation(wf, startSimulation(wf, { x: 1 }));
        expect(state.status).toBe('failed');
        expect(state.error?.nodeId).toBe('start');
        expect(state.error?.message).toContain('No matching outgoing edge');
    });

    it('surfaces a condition evaluation error tied to the offending edge', () => {
        const wf = workflow(
            [node('start', 'start'), node('a', 'end'), node('b', 'end')],
            [
                edge('bad', 'start', 'a', { priority: 1, condition: 'this is !!! not valid' }),
                edge('def', 'start', 'b', { priority: 2, isDefault: true }),
            ],
        );
        const state = stepSimulation(wf, startSimulation(wf, {}));
        expect(state.status).toBe('failed');
        expect(state.error?.edgeId).toBe('bad');
        expect(state.edgeEvaluations['bad'].result).toBe('error');
        expect(state.edgeEvaluations['bad'].error).toBeTruthy();
    });
});

describe('node lifecycle', () => {
    it('blocks at an action node and merges its mock output into context', () => {
        const wf = workflow(
            [node('start', 'start'), node('act', 'action', { actionType: 'x' }), node('end', 'end')],
            [edge('e1', 'start', 'act'), edge('e2', 'act', 'end')],
        );
        let state = stepSimulation(wf, startSimulation(wf, {}));
        expect(state.status).toBe('blocked');
        expect(state.blockedOn).toEqual({ nodeId: 'act', kind: 'action' });

        state = resumeSimulation(wf, state, { output: { severity: 'high' } });
        expect(state.status).toBe('running');
        expect(state.context.severity).toBe('high');

        state = stepSimulation(wf, state);
        expect(state.status).toBe('completed');
        expect(state.currentNodeId).toBe('end');
    });

    it('blocks at a human-task node', () => {
        const wf = workflow(
            [node('start', 'start'), node('task', 'human-task'), node('end', 'end')],
            [edge('e1', 'start', 'task'), edge('e2', 'task', 'end')],
        );
        const state = stepSimulation(wf, startSimulation(wf, {}));
        expect(state.blockedOn?.kind).toBe('human-task');
    });

    it('blocks at a receive-event node', () => {
        const wf = workflow(
            [node('start', 'start'), node('recv', 'receive-event', { eventType: 'pr.merged' }), node('end', 'end')],
            [edge('e1', 'start', 'recv'), edge('e2', 'recv', 'end')],
        );
        const state = stepSimulation(wf, startSimulation(wf, {}));
        expect(state.blockedOn?.kind).toBe('receive-event');
    });

    it('routes through a wait node without blocking', () => {
        const wf = workflow(
            [node('start', 'start'), node('w', 'wait', { duration: 'PT1H' }), node('end', 'end')],
            [edge('e1', 'start', 'w'), edge('e2', 'w', 'end')],
        );
        const state = runSimulation(wf, startSimulation(wf, {}));
        expect(state.status).toBe('completed');
        expect(state.visitedNodeIds).toEqual(['start', 'w', 'end']);
    });

    it('guards against infinite loops with MAX_TRANSITIONS', () => {
        const wf = workflow(
            [node('start', 'start'), node('w1', 'wait'), node('w2', 'wait')],
            [edge('e1', 'start', 'w1'), edge('e2', 'w1', 'w2'), edge('e3', 'w2', 'w1')],
        );
        const state = runSimulation(wf, startSimulation(wf, {}));
        expect(state.status).toBe('failed');
        expect(state.error?.message).toContain('transition limit');
        expect(state.transitions).toBeGreaterThanOrEqual(MAX_TRANSITIONS);
    });
});

describe('end-to-end with the cveTriage sample', () => {
    it('takes the "affected" branch to Mitigated', () => {
        const state = runWithMocks(cveTriage, { cveId: 'CVE-1' }, [
            { severity: 'high', affectedVersions: '1.0.0' }, // analyze
            { affected: true, triageNotes: 'confirmed' },     // triage
            { mitigationPlan: 'upgrade' },                     // mitigate
        ]);
        expect(state.status).toBe('completed');
        expect(state.currentNodeId).toBe('end-mitigated');
        expect(state.visitedNodeIds).toEqual(['start', 'analyze', 'triage', 'mitigate', 'end-mitigated']);
        expect(state.edgeEvaluations['e3'].result).toBe('matched');
        expect(state.edgeEvaluations['e4'].result).toBe('skipped');
    });

    it('takes the default "not affected" branch to Not Affected', () => {
        const state = runWithMocks(cveTriage, { cveId: 'CVE-1' }, [
            { severity: 'low' },        // analyze
            { affected: false },        // triage
            { closedAt: '2026-01-01' }, // close
        ]);
        expect(state.status).toBe('completed');
        expect(state.currentNodeId).toBe('end-not-affected');
        expect(state.edgeEvaluations['e3'].result).toBe('false');
        expect(state.edgeEvaluations['e4'].result).toBe('matched');
    });
});

describe('active-branch model — linear parity', () => {
    it('runs a linear flow on the root branch with attributed history', () => {
        const wf = workflow(
            [node('start', 'start'), node('act', 'action'), node('end', 'end')],
            [edge('e1', 'start', 'act'), edge('e2', 'act', 'end')],
        );
        let state = startSimulation(wf, {});
        expect(state.activeBranches).toEqual([{ branchId: 'root', nodeId: 'start' }]);
        state = runSimulation(wf, state);
        expect(state.status).toBe('blocked');
        expect(state.currentNodeId).toBe('act');
        expect(state.blockedOn?.nodeId).toBe('act');
        expect(state.activeBranches).toEqual([{ branchId: 'root', nodeId: 'act' }]);
        state = resumeSimulation(wf, state, { output: { done: true } });
        state = runSimulation(wf, state);
        expect(state.status).toBe('completed');
        expect(state.history.every(h => h.branchId === 'root')).toBe(true);
    });
});

describe('fork / AND-join', () => {
    // start -> f(fork) -> a, b ; a -> j, b -> j ; j -> end. a and b are actions (block for a mock).
    function forkJoin(): Workflow {
        return workflow(
            [node('start', 'start'), node('f', 'wait'), node('a', 'action'), node('b', 'action'),
                node('j', 'wait'), node('end', 'end')],
            [edge('s', 'start', 'f'), edge('fa', 'f', 'a'), edge('fb', 'f', 'b'),
                edge('aj', 'a', 'j'), edge('bj', 'b', 'j'), edge('je', 'j', 'end')],
        );
    }

    it('fans out into both branches and parks each on its action', () => {
        const state = runSimulation(forkJoin(), startSimulation(forkJoin(), {}));
        expect(state.status).toBe('blocked');
        const parkedNodes = state.activeBranches
            .filter(b => state.parkedBranchIds.includes(b.branchId))
            .map(b => b.nodeId)
            .sort();
        expect(parkedNodes).toEqual(['a', 'b']);
        expect(state.currentNodeId).toBe(''); // two active branches -> no single current node
    });

    it('waits for all branches, then fires the join once and completes', () => {
        const wf = forkJoin();
        let state = runSimulation(wf, startSimulation(wf, {}));
        // resume branch at 'a' only -> join must NOT fire yet; sibling 'b' still blocked
        state = resumeSimulation(wf, state, { output: { fromA: 1 } }, 'a');
        state = runSimulation(wf, state);
        expect(state.status).toBe('blocked');
        expect(state.visitedNodeIds.filter(id => id === 'j')).toHaveLength(0);
        // resume branch at 'b' -> all arrived -> join fires once -> end
        state = resumeSimulation(wf, state, { output: { fromB: 2 } }, 'b');
        state = runSimulation(wf, state);
        expect(state.status).toBe('completed');
        expect(state.visitedNodeIds.filter(id => id === 'j')).toHaveLength(1);
        expect(state.context).toMatchObject({ fromA: 1, fromB: 2 });
    });

    it('attributes branch history to distinct child branch ids', () => {
        const wf = forkJoin();
        const state = runSimulation(wf, startSimulation(wf, {}));
        const branchIds = new Set(state.history.map(h => h.branchId));
        expect(branchIds.has('root.0')).toBe(true);
        expect(branchIds.has('root.1')).toBe(true);
    });

    it('fails the whole simulation when one branch cannot route', () => {
        // branch 'b' leads to a node with a condition that never matches and no default -> no edge.
        const wf = workflow(
            [node('start', 'start'), node('f', 'wait'), node('a', 'wait'), node('b', 'wait'),
                node('j', 'wait'), node('dead', 'wait'), node('end', 'end')],
            [edge('s', 'start', 'f'), edge('fa', 'f', 'a'), edge('fb', 'f', 'b'),
                edge('aj', 'a', 'j'), edge('bd', 'b', 'dead', { condition: 'context.never == true' }),
                edge('je', 'j', 'end')],
        );
        const state = runSimulation(wf, startSimulation(wf, {}));
        expect(state.status).toBe('failed');
        expect(state.error?.message).toContain('No matching outgoing edge');
    });

    it('handles a nested fork/join and completes once', () => {
        // start -> f -> a, g(inner fork) ; g -> c, d ; c -> ij, d -> ij ; ij -> j ; a -> j ; j -> end
        const wf = workflow(
            [node('start', 'start'), node('f', 'wait'), node('a', 'wait'), node('g', 'wait'),
                node('c', 'wait'), node('d', 'wait'), node('ij', 'wait'), node('j', 'wait'),
                node('end', 'end')],
            [edge('s', 'start', 'f'), edge('fa', 'f', 'a'), edge('fg', 'f', 'g'),
                edge('gc', 'g', 'c'), edge('gd', 'g', 'd'), edge('cij', 'c', 'ij'), edge('dij', 'd', 'ij'),
                edge('ijj', 'ij', 'j'), edge('aj', 'a', 'j'), edge('je', 'j', 'end')],
        );
        const state = runSimulation(wf, startSimulation(wf, {}));
        expect(state.status).toBe('completed');
        expect(state.visitedNodeIds.filter(id => id === 'j')).toHaveLength(1);
        expect(state.visitedNodeIds.filter(id => id === 'ij')).toHaveLength(1);
    });
});
