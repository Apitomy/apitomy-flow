import { expect, it } from 'vitest';
import { createEditorState, editorReducer } from './editorState.ts';
import { validateWorkflow } from '../validation/validateWorkflow.ts';
import { analyzeParallelRegions } from '../simulation/parallelRegions.ts';
import type { Workflow } from '../types/workflow.ts';

it.skipIf(!process.env.FLOW_BENCHMARK)('measures large graph validation during layout/history edits', () => {
    const workflow: Workflow = {
        id: 'benchmark', name: 'Benchmark',
        nodes: Array.from({ length: 300 }, (_, i) => ({ id: `n${i}`, name: `Node ${i}`,
            type: i === 0 ? 'start' : i === 299 ? 'end' : 'wait',
            config: i === 0 || i === 299 ? {} : { duration: 'PT1S' }, position: { x: i * 200, y: 0 } })),
        edges: Array.from({ length: 299 }, (_, i) => ({ id: `e${i}`, source: `n${i}`, target: `n${i + 1}`,
            priority: 0, isDefault: false })),
    };
    for (let sample = -2; sample < 5; sample++) {
        let state = createEditorState(workflow);
        let previous: Workflow | undefined;
        let validations = 0;
        const started = performance.now();
        for (let edit = 0; edit < 60; edit++) {
            state = editorReducer(state, { type: 'positions', positions: { n1: { x: edit, y: edit } } });
            // Mirrors the editor's memo boundary. C13 will retain semanticDocument across layout edits.
            const semantic = (state as { semanticDocument?: Workflow }).semanticDocument ?? state.document;
            if (semantic !== previous) {
                expect(validateWorkflow(semantic).filter(problem => problem.severity === 'error')).toEqual([]);
                expect(analyzeParallelRegions(semantic).problems).toEqual([]);
                validations++;
                previous = semantic;
            }
        }
        expect(state.past).toHaveLength(50);
        if (sample >= 0) process.stdout.write(`C13 editor_ms=${(performance.now() - started).toFixed(3)} validations=${validations}\n`);
    }
});
