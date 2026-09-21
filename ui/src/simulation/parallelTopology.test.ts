import { describe, expect, it } from 'vitest';
import fixtures from '../../../conformance/parallel-topology.json';
import { type Workflow } from '../types/workflow.ts';
import { validateWorkflow } from '../validation/validateWorkflow.ts';
import { analyzeParallelRegions } from './parallelRegions.ts';
import { startSimulation, runSimulation, resumeSimulation } from './simulate.ts';

describe('shared parallel topology fixtures', () => {
    for (const fixture of fixtures) {
        const workflow: Workflow = {
            id: 'topology', name: 'Topology',
            nodes: fixture.nodes.map(id => ({
                id, name: id, type: id === 'start' ? 'start' : id === 'end' ? 'end' : 'action',
                config: id === 'start' || id === 'end' ? {} : { actionType: 'record' },
                position: { x: 0, y: 0 },
            })),
            edges: fixture.edges.map(([source, target, condition], i) => ({
                id: `e${i}`, source, target, priority: i, isDefault: condition === 'default',
                condition: condition === 'default' ? undefined : condition,
            })),
        };

        it(`${fixture.name}: analyzer and validator agree`, () => {
            const regions = analyzeParallelRegions(workflow);
            const problems = validateWorkflow(workflow);
            if (fixture.problem) {
                expect(regions.problems).toContainEqual(fixture.problem);
                expect(problems).toContainEqual(expect.objectContaining({ ...fixture.problem, severity: 'error' }));
            } else {
                expect(regions.problems).toEqual([]);
                expect(problems.filter(p => p.severity === 'error')).toEqual([]);
            }
        });

        it(`${fixture.name}: rejects before entry or completes balanced regions`, () => {
            for (const choose of [true, false]) {
                let state = startSimulation(workflow, { choose });
                if (fixture.problem) {
                    expect(state.status).toBe('failed');
                    expect(state.error?.message).toContain(fixture.problem.code);
                    expect(state.error?.nodeId).toBe(fixture.problem.nodeId);
                    expect(state.history).toEqual([]);
                    expect(state.activeBranches).toEqual([]);
                    expect(state.transitions).toBe(0);
                } else {
                    state = runSimulation(workflow, state);
                    for (let attempts = 0; state.status === 'blocked' && attempts < 50; attempts++) {
                        const id = (choose ? state.activeBranches[0] : state.activeBranches.at(-1)!).nodeId;
                        const count = state.visitedNodeIds.filter(nodeId => nodeId === id).length;
                        state = runSimulation(workflow, resumeSimulation(workflow, state, {
                            output: id === fixture.repeatAt ? { repeat: count < 2 } : {},
                        }, id));
                    }
                    expect(state.status).toBe('completed');
                    expect(state.joinArrivals).toEqual({});
                    for (const [id, count] of Object.entries(fixture.visits!)) {
                        expect(state.visitedNodeIds.filter(nodeId => nodeId === id), id).toHaveLength(count!);
                    }
                }
            }
        });
    }
});
