import { describe, expect, it } from 'vitest';
import Ajv from 'ajv';
import schema from '../../../conformance/workflow-v1.schema.json';
import example from '../../../conformance/config-v1.json';
import invalid from '../../../conformance/config-invalid-v1.json';
import { validateWorkflow } from '../validation/validateWorkflow.ts';
import { parseWorkflow, serializeWorkflow } from '../utils/workflowIo.ts';
import { toReactFlowNodes, toReactFlowEdges, toWorkflow } from '../utils/conversion.ts';

const validate = new Ajv({ strict: true }).compile(schema);

describe('version 1 shared wire contract', () => {
    it('accepts every built-in config and preserves nested extensions and explicit nulls through editing', () => {
        expect(validate(example.workflow), JSON.stringify(validate.errors)).toBe(true);
        const parsed = parseWorkflow(JSON.stringify(example.workflow));
        expect(parsed.error).toBeUndefined();
        expect(parsed.workflow).toBeDefined();
        const workflow = parsed.workflow!;
        const edited = toWorkflow(workflow, toReactFlowNodes(workflow.nodes), toReactFlowEdges(workflow.edges));
        const exported = JSON.parse(serializeWorkflow(edited));
        expect(validate(exported), JSON.stringify(validate.errors)).toBe(true);
        expect(exported.nodes.map((node: { config: unknown }) => node.config))
            .toEqual(example.workflow.nodes.map(node => node.config));
    });

    it.each(invalid)('rejects structurally invalid $type config', ({ type, config, code }) => {
        const workflow = { ...example.workflow, nodes: [{ id: 'bad', type, config }] };
        expect(validate(workflow)).toBe(false);
        expect(validateWorkflow(workflow)).toEqual(expect.arrayContaining([
            expect.objectContaining({ code, severity: 'error' }),
        ]));
    });

    it('allows missing and null config/position while rejecting malformed coordinates', () => {
        for (const extra of [{}, { config: null, position: null }]) {
            expect(validate({ ...example.workflow, nodes: [{ id: 'end', type: 'end', ...extra }] })).toBe(true);
        }
        expect(validate({ ...example.workflow, nodes: [{ id: 'end', type: 'end', position: { x: 1 } }] })).toBe(false);
    });
});
