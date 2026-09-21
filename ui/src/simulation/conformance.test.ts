import { describe, expect, it } from 'vitest';
import expressions from '../../../conformance/expressions.json';
import routing from '../../../conformance/routing.json';
import budgets from '../../../conformance/budgets.json';
import validation from '../../../conformance/validation.json';
import { classifyExpression, evaluateCondition, isValidExpression, resolveExpression } from './elEvaluator.ts';
import { validateWorkflow } from '../validation/validateWorkflow.ts';
import { parseWorkflow, serializeWorkflow } from '../utils/workflowIo.ts';
import { type Workflow } from '../types/workflow.ts';
import { startSimulation, runSimulation, resumeSimulation, stepSimulation, type SimState } from './simulate.ts';
import { mapToPairs, pairsToMap } from '../utils/mapInputs.ts';

/** Exercises the same expression in both validation sites without unrelated warnings. */
function expressionWorkflow(expression: string): Workflow {
    return {
        id: 'expression', name: 'Expression',
        nodes: [
            { id: 'start', name: 'Start', type: 'start', config: { inputs: [] }, position: { x: 0, y: 0 } },
            { id: 'event', name: 'Event', type: 'receive-event', position: { x: 100, y: 0 },
                config: { eventType: 'test', outputs: [{ contextKey: 'result', expression }] } },
            { id: 'end', name: 'End', type: 'end', config: {}, position: { x: 200, y: 0 } },
        ],
        edges: [
            { id: 'condition', source: 'start', target: 'event', condition: expression, priority: 0, isDefault: false },
            { id: 'fallback', source: 'start', target: 'end', priority: 1, isDefault: true },
            { id: 'finish', source: 'event', target: 'end', priority: 0, isDefault: false },
        ],
    };
}

describe('shared expression conformance', () => {
    for (const fixture of expressions) {
        const scope = { context: fixture.context ?? {}, event: fixture.event ?? {} };
        it(`${fixture.name}: evaluation`, () => {
            expect(classifyExpression(fixture.expression))
                .toBe(fixture.invalid ? 'invalid' : fixture.browser ?? 'supported');
            if (fixture.invalid || fixture.browser === 'unsupported') {
                expect(isValidExpression(fixture.expression)).toBe(false);
                expect(() => resolveExpression(fixture.expression, scope)).toThrow();
                if (fixture.browser === 'unsupported') {
                    expect(() => resolveExpression(fixture.expression, scope)).toThrow(/unsupported.*browser/i);
                }
            } else {
                expect(isValidExpression(fixture.expression)).toBe(true);
                expect(resolveExpression(fixture.expression, scope)).toEqual(fixture.value);
                expect(evaluateCondition(fixture.expression, scope)).toBe(fixture.condition ?? fixture.value === true);
            }
        });

        if (fixture.expression.trim()) {
            it(`${fixture.name}: condition and event mapping validation`, () => {
                const workflow = expressionWorkflow(fixture.expression);
                const problems = validateWorkflow(workflow).map(({ code, severity, nodeId, edgeId }) =>
                    ({ code, severity, ...(nodeId ? { nodeId } : {}), ...(edgeId ? { edgeId } : {}) }));
                expect(problems).toEqual(fixture.invalid ? [
                    { code: 'INVALID_CONDITION', severity: 'warning', edgeId: 'condition' },
                    { code: 'INVALID_OUTPUT_EXPRESSION', severity: 'error', nodeId: 'event' },
                ] : fixture.browser === 'unsupported' ? [
                    { code: 'UNSUPPORTED_EXPRESSION_DIALECT', severity: 'warning', edgeId: 'condition' },
                    { code: 'UNSUPPORTED_EXPRESSION_DIALECT', severity: 'warning', nodeId: 'event' },
                ] : []);
                expect(parseWorkflow(JSON.stringify(workflow)).workflow !== undefined).toBe(!fixture.invalid);
            });
        }
    }
});

describe('shared routing and serialization conformance', () => {
    for (const fixture of routing) {
        it(fixture.name, () => {
            const parsed = parseWorkflow(JSON.stringify(fixture.workflow));
            expect(parsed.problems.map(p => `${p.code}:${p.severity}:${p.edgeId ?? p.nodeId}`)).toEqual(fixture.problems);
            const workflow = parsed.workflow!;
            expect(JSON.parse(serializeWorkflow(workflow))).toMatchObject(fixture.workflow);
            let state = runSimulation(workflow, startSimulation(workflow, fixture.context));
            for (const step of fixture.steps) {
                // Persistence between every completion must preserve parked branches and join arrivals.
                state = JSON.parse(JSON.stringify(state)) as SimState;
                if ('resume' in step) {
                    state = runSimulation(workflow, resumeSimulation(workflow, state, { output: step.output }, step.resume));
                }
                expect(state.status).toBe('completed' in step ? 'completed' : 'blocked');
                expect(state.activeBranches).toEqual(step.activeBranches);
                expect(state.joinArrivals).toEqual(step.joinArrivals);
                expect(state.context).toEqual(step.context);
                expect(state.visitedNodeIds).toEqual(step.visited);
                if (fixture.inputs && state.currentNodeId === 'fork') {
                    const node = workflow.nodes.find(node => node.id === 'fork')!;
                    const inputs = node.config.inputs as Record<string, unknown>;
                    expect(pairsToMap(mapToPairs(inputs))).toEqual(inputs);
                    expect(resolveExpression(inputs.expression as string, { context: state.context }))
                        .toEqual(fixture.inputs.fork.expression);
                }
            }
        });
    }
});

/** Builds equal-length resume segments; browser waits stand in for completed engine actions. */
function budgetWorkflow(transitions: number): Workflow {
    const workflow = expressionWorkflow('true');
    workflow.nodes[1] = { id: 'task', name: 'Task', type: 'human-task', config: {}, position: { x: 0, y: 0 } };
    workflow.edges = [{ id: 'begin', source: 'start', target: 'task', priority: 0, isDefault: false }];
    let source = 'task';
    for (let i = 1; i < transitions; i++) {
        const id = `auto${i}`;
        workflow.nodes.push({ id, name: id, type: 'wait', config: {}, position: { x: 0, y: 0 } });
        workflow.edges.push({ id: `e${i}`, source, target: id, priority: 0, isDefault: false });
        source = id;
    }
    workflow.edges.push({ id: 'repeat', source, target: 'task', priority: 0, isDefault: false, condition: 'context.repeat' },
        { id: 'finish', source, target: 'end', priority: 1, isDefault: true });
    return workflow;
}

describe('shared advancement budgets', () => {
    for (const fixture of budgets) {
        for (const stepping of [false, true]) {
            it(`${fixture.name}: ${stepping ? 'step' : 'run'}`, () => {
                const workflow = budgetWorkflow(fixture.transitionsPerResume);
                let state = runSimulation(workflow, startSimulation(workflow, {}));
                for (let i = 0; i < fixture.resumes; i++) {
                    expect(state.status).toBe('blocked');
                    expect(resumeSimulation(workflow, state, {}, 'missing')).toBe(state);
                    state = resumeSimulation(workflow, state, { output: { repeat: i < fixture.resumes - 1 } });
                    if (stepping) {
                        while (state.status === 'running') state = stepSimulation(workflow, state);
                    } else {
                        state = runSimulation(workflow, state);
                    }
                }
                expect(state.status).toBe(fixture.status);
                if (fixture.status === 'failed') expect(state.error?.message).toContain('transition limit');
            });
        }
    }
});

describe('shared duration validation', () => {
    for (const fixture of validation) {
        it(fixture.name, () => {
            const workflow = expressionWorkflow('true');
            workflow.nodes[1] = { id: 'wait', name: 'Wait', type: 'wait',
                config: fixture.duration === undefined ? {} : { duration: fixture.duration }, position: { x: 100, y: 0 } };
            workflow.edges = [{ id: 'begin', source: 'start', target: 'wait', priority: 0, isDefault: false },
                { id: 'finish', source: 'wait', target: 'end', priority: 0, isDefault: false }];
            expect(validateWorkflow(workflow).map(p => `${p.code}:${p.severity}:${p.nodeId}`))
                .toEqual(fixture.browserProblems ?? fixture.problems);
        });
    }
});
