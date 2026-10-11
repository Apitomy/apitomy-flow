import { describe, it, expect } from 'vitest';
import { respond, spacedOut, type AgentRequest } from './mockAgent.ts';
import { validateWorkflow } from '../../validation/validateWorkflow.ts';
import { NODE_DIMENSIONS } from '../../layout/layoutWorkflow.ts';
import { cveTriage } from '../sampleWorkflows.ts';
import { applyChangeSetChecked } from '../../changeset/applyChangeSet.ts';
import { computeContentRevision } from '../../changeset/contentRevision.ts';
import type { Workflow } from '../../types/workflow.ts';

const revision = computeContentRevision(cveTriage);
const apply = (request: AgentRequest, workflow: Workflow = cveTriage) => {
    const response = respond(request, workflow, computeContentRevision(workflow));
    expect(response.changeSet, response.message).toBeDefined();
    const result = applyChangeSetChecked(workflow, response.changeSet!);
    expect(result.ok, JSON.stringify(result)).toBe(true);
    return result.ok ? result.workflow : workflow;
};
const node = (workflow: Workflow, id: string) => workflow.nodes.find(candidate => candidate.id === id);
const edgesFrom = (workflow: Workflow, id: string) => workflow.edges.filter(edge => edge.source === id);

describe('mock agent', () => {
    it('inserts a wait after a step, keeping the original edge routing', () => {
        const next = apply({ kind: 'add-wait', nodeId: 'mitigate' });
        const wait = next.nodes.find(candidate => candidate.type === 'wait')!;
        expect(edgesFrom(next, 'mitigate').map(edge => edge.target)).toEqual([wait.id]);
        expect(edgesFrom(next, wait.id).map(edge => edge.target)).toEqual(['end-mitigated']);
        expect(wait.position).toBeDefined();
    });

    it('keeps the condition and label when inserting after a conditional edge', () => {
        const next = apply({ kind: 'add-wait', nodeId: 'triage' });
        const [first] = edgesFrom(next, 'triage').filter(edge => edge.label === 'Affected');
        expect(first.condition).toBe('context.affected == true');
        expect(node(next, first.target)?.type).toBe('wait');
    });

    it('generates unique ids across repeated requests', () => {
        const once = apply({ kind: 'add-wait', nodeId: 'mitigate' });
        const twice = apply({ kind: 'add-wait', nodeId: 'mitigate' }, once);
        expect(twice.nodes.filter(candidate => candidate.type === 'wait')).toHaveLength(2);
    });

    it('refuses to add a wait after an end node', () => {
        expect(respond({ kind: 'add-wait', nodeId: 'end-mitigated' }, cveTriage, revision).changeSet).toBeUndefined();
    });

    it('renames a step', () => {
        expect(node(apply({ kind: 'rename', nodeId: 'mitigate' }), 'mitigate')?.name).toBe('Draft Mitigation Plan');
        expect(node(apply({ kind: 'rename', nodeId: 'close' }), 'close')?.name).toBe('Close Tracker (refined)');
    });

    it('explains a step without changing the workflow', () => {
        const response = respond({ kind: 'explain', nodeId: 'triage' }, cveTriage, revision);
        expect(response.changeSet).toBeUndefined();
        expect(response.message).toContain('Triage Decision');
        expect(response.message).toContain('Plan Mitigation');
    });

    it('adds a notification at the requested position', () => {
        const next = apply({ kind: 'add-notification', position: { x: 120, y: 480 } });
        const added = next.nodes.find(candidate => candidate.type === 'action' && candidate.config.actionType === 'send-email')!;
        expect(added.position).toEqual({ x: 120, y: 480 });
    });

    it('fixes an unknown Action Type by asking the host to add it to the catalog', () => {
        const response = respond({ kind: 'fix-problem', problem: { severity: 'error', code: 'HOST_UNKNOWN_ACTION_TYPE',
            message: 'Action type "plan-mitigation" is not in the host catalog', nodeId: 'mitigate' } }, cveTriage, revision);
        expect(response.changeSet).toBeUndefined();
        expect(response.addActionTypes?.map(descriptor => descriptor.value)).toEqual(['plan-mitigation']);
        expect(response.addActionTypes?.[0].inputs?.map(field => field.name)).toEqual(['CVE ID', 'Severity', 'Triage Notes']);
        expect(response.addActionTypes?.[0].outputs?.map(field => field.name)).toEqual(['mitigationPlan']);
    });

    it('declines problems it has no script for', () => {
        const response = respond({ kind: 'fix-problem', problem: { severity: 'warning', code: 'OTHER', message: 'm' } },
            cveTriage, revision);
        expect(response.changeSet).toBeUndefined();
        expect(response.addActionTypes).toBeUndefined();
    });

    it('adds an escalation path after Analyze CVE', () => {
        const next = apply({ kind: 'add-error-handling' });
        const escalation = edgesFrom(next, 'analyze').find(edge => edge.condition)!;
        expect(escalation.condition).toBe("context.severity == 'critical'");
        const notify = node(next, escalation.target)!;
        expect(notify.type).toBe('action');
        expect(edgesFrom(next, notify.id).map(edge => node(next, edge.target)?.type)).toEqual(['end']);
    });

    it('produces change sets that go stale when the workflow changes in the meantime', () => {
        const response = respond({ kind: 'rename', nodeId: 'mitigate' }, cveTriage, revision);
        const edited: Workflow = { ...cveTriage, name: 'Edited by the user' };
        const result = applyChangeSetChecked(edited, response.changeSet!);
        expect(!result.ok && result.error.code).toBe('stale');
    });

    it('places an inserted wait between its neighbours on a spaced-out workflow', () => {
        const spaced = spacedOut(cveTriage, 1.4);
        const next = apply({ kind: 'add-wait', nodeId: 'mitigate' }, spaced);
        const wait = next.nodes.find(candidate => candidate.type === 'wait')!;
        const source = node(spaced, 'mitigate')!;
        const target = node(spaced, 'end-mitigated')!;
        expect(wait.position!.x).toBeGreaterThan(source.position!.x + NODE_DIMENSIONS.action.width);
        expect(wait.position!.x + NODE_DIMENSIONS.wait.width).toBeLessThan(target.position!.x);
    });

    it('spreads node positions horizontally without changing content', () => {
        const spaced = spacedOut(cveTriage, 2);
        expect(node(spaced, 'analyze')!.position).toEqual({ x: 500, y: 200 });
        expect(computeContentRevision(spaced)).toBe(revision);
    });

    it('keeps the workflow free of new errors when adding the escalation path', () => {
        const errors = (workflow: Workflow) => validateWorkflow(workflow).filter(problem => problem.severity === 'error');
        expect(errors(apply({ kind: 'add-error-handling' }))).toEqual(errors(cveTriage));
    });
});
