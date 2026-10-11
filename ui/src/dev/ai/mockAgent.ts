import type { ChangeOp, ChangeSet } from '../../changeset/types.ts';
import type { ActionTypeDescriptor, ActionTypeField } from '../../types/spi.ts';
import type { ValidationProblem } from '../../types/validation.ts';
import type { Workflow, WorkflowEdge, WorkflowNode } from '../../types/workflow.ts';
import { NODE_DIMENSIONS } from '../../layout/layoutWorkflow.ts';

/** What the demo user asked the scripted assistant to do. */
export type AgentRequest =
    | { kind: 'add-wait'; nodeId: string }
    | { kind: 'rename'; nodeId: string }
    | { kind: 'explain'; nodeId: string }
    | { kind: 'add-notification'; position: { x: number; y: number } }
    | { kind: 'fix-problem'; problem: ValidationProblem }
    | { kind: 'add-error-handling' };

/** The assistant's reply: a chat message, plus optionally a change set and Action Types for the host catalog. */
export interface AgentResponse {
    message: string;
    changeSet?: ChangeSet;
    addActionTypes?: ActionTypeDescriptor[];
}

/** Author id used for every change set the demo assistant produces. */
export const AGENT_AUTHOR = 'agent:demo' as const;

const RENAMES: Record<string, string> = {
    'Plan Mitigation': 'Draft Mitigation Plan',
    'Analyze CVE': 'Assess CVE Impact',
    'Triage Decision': 'Confirm Exposure',
};

let changeSetCounter = 0;

function changeSet(baseRevision: string, summary: string, ops: ChangeOp[]): ChangeSet {
    changeSetCounter += 1;
    return { id: `demo-${changeSetCounter}`, baseRevision, author: AGENT_AUTHOR, summary, ops };
}

function uniqueId(workflow: Workflow, prefix: string, taken: string[] = []): string {
    const used = new Set([...workflow.nodes.map(node => node.id), ...workflow.edges.map(edge => edge.id), ...taken]);
    for (let index = 1; ; index += 1) {
        const candidate = `${prefix}-${index}`;
        if (!used.has(candidate)) return candidate;
    }
}

function findNode(workflow: Workflow, id: string | undefined): WorkflowNode | undefined {
    return workflow.nodes.find(node => node.id === id);
}

function between(from: WorkflowNode, to: WorkflowNode | undefined, inserted: WorkflowNode['type']): { x: number; y: number } | undefined {
    if (!from.position) return undefined;
    const fromRight = from.position.x + NODE_DIMENSIONS[from.type].width;
    if (!to?.position) return { x: fromRight + 60, y: from.position.y };
    const middle = (fromRight + to.position.x) / 2;
    return { x: Math.round(middle - NODE_DIMENSIONS[inserted].width / 2), y: from.position.y };
}

/**
 * Spreads a workflow's node positions horizontally so the assistant has room to insert steps.
 *
 * @param workflow the workflow
 * @param factor horizontal scale factor
 * @returns a copy with scaled x coordinates (content, and so the content revision, is unchanged)
 */
export function spacedOut(workflow: Workflow, factor: number): Workflow {
    return { ...workflow, nodes: workflow.nodes.map(node => (node.position
        ? { ...node, position: { x: Math.round(node.position.x * factor), y: node.position.y } } : node)) };
}

function addWait(workflow: Workflow, revision: string, nodeId: string): AgentResponse {
    const source = findNode(workflow, nodeId);
    if (!source) return { message: `I can't find a step with id "${nodeId}".` };
    if (source.type === 'end') return { message: `"${source.name}" ends the workflow, so there is no next step to wait before.` };
    const waitId = uniqueId(workflow, 'wait');
    const outgoing: WorkflowEdge | undefined = workflow.edges.find(edge => edge.source === nodeId);
    const target = findNode(workflow, outgoing?.target);
    const wait: WorkflowNode = { id: waitId, type: 'wait', name: 'Cool-off Wait', config: { duration: 'PT1H' },
        ...(between(source, target, 'wait') ? { position: between(source, target, 'wait') } : {}) };
    const ops: ChangeOp[] = [{ op: 'addNode', node: wait }];
    if (outgoing) {
        const inId = uniqueId(workflow, 'edge', [waitId]);
        const outId = uniqueId(workflow, 'edge', [waitId, inId]);
        ops.unshift({ op: 'removeEdge', id: outgoing.id });
        ops.push({ op: 'addEdge', edge: { ...outgoing, id: inId, target: waitId } });
        ops.push({ op: 'addEdge', edge: { id: outId, source: waitId, target: outgoing.target, priority: 0, isDefault: false } });
    } else {
        ops.push({ op: 'addEdge', edge: { id: uniqueId(workflow, 'edge', [waitId]), source: nodeId, target: waitId,
            priority: 0, isDefault: false } });
    }
    const summary = `Add a one-hour wait after "${source.name}"`;
    return { message: `${summary}${target ? `, before "${target.name}"` : ''}.`, changeSet: changeSet(revision, summary, ops) };
}

function rename(workflow: Workflow, revision: string, nodeId: string): AgentResponse {
    const target = findNode(workflow, nodeId);
    if (!target) return { message: `I can't find a step with id "${nodeId}".` };
    const name = RENAMES[target.name] ?? `${target.name} (refined)`;
    const summary = `Rename "${target.name}" to "${name}"`;
    return { message: `${summary} to describe the step more precisely.`,
        changeSet: changeSet(revision, summary, [{ op: 'updateNode', id: nodeId, patch: { name } }]) };
}

function explain(workflow: Workflow, nodeId: string): AgentResponse {
    const target = findNode(workflow, nodeId);
    if (!target) return { message: `I can't find a step with id "${nodeId}".` };
    const next = workflow.edges.filter(edge => edge.source === nodeId).map(edge => {
        const name = findNode(workflow, edge.target)?.name ?? edge.target;
        return edge.condition ? `"${name}" when ${edge.condition}` : `"${name}"`;
    });
    const config = target.config as Record<string, unknown>;
    const detail = target.type === 'action' ? ` It runs the "${String(config.actionType)}" Action Type.`
        : target.type === 'human-task' ? ' It waits for a person to complete a task.' : '';
    const flow = next.length ? ` Next it continues to ${next.join(' or ')}.` : ' It ends the workflow.';
    return { message: `"${target.name}" is a ${target.type} step.${detail}${flow}` };
}

function addNotification(workflow: Workflow, revision: string, position: { x: number; y: number }): AgentResponse {
    const node: WorkflowNode = { id: uniqueId(workflow, 'notify'), type: 'action', name: 'Notify Security Team', position: {
        x: Math.round(position.x), y: Math.round(position.y) }, config: {
        actionType: 'send-email',
        inputs: { to: "'security@example.com'", subject: "'CVE update: ' += context.cveId", body: 'context.triageNotes' },
        outputs: [{ name: 'messageId', type: 'string', required: true }],
    } };
    const summary = 'Add a "Notify Security Team" email step';
    return { message: `${summary}. Connect it where the team should be told.`,
        changeSet: changeSet(revision, summary, [{ op: 'addNode', node }]) };
}

function fields(names: string[]): ActionTypeField[] {
    return names.map(name => ({ name, type: 'string' as const, required: true }));
}

function fixProblem(workflow: Workflow, problem: ValidationProblem): AgentResponse {
    const target = findNode(workflow, problem.nodeId);
    if (problem.code === 'HOST_UNKNOWN_ACTION_TYPE' && target?.type === 'action'
        && typeof target.config.actionType === 'string') {
        const value = target.config.actionType;
        const label = value.split(/[-_.]/).map(part => part.charAt(0).toUpperCase() + part.slice(1)).join(' ');
        const inputs = fields(Object.keys(target.config.inputs ?? {}));
        const outputs = fields((target.config.outputs ?? []).map(output => output.name));
        return {
            message: `"${value}" is missing from the catalog. I asked the host to create the "${label}" Action Type from how "${target.name}" uses it.`,
            addActionTypes: [{ value, label, description: 'Created by the AI assistant', inputs, outputs }],
        };
    }
    return { message: `I don't have a scripted fix for ${problem.code} yet.` };
}

function addErrorHandling(workflow: Workflow, revision: string): AgentResponse {
    const analyze = findNode(workflow, 'analyze');
    if (!analyze) return { message: 'This workflow has no "analyze" step to add escalation after.' };
    const notifyId = uniqueId(workflow, 'escalate');
    const endId = uniqueId(workflow, 'end-escalated', [notifyId]);
    const toNotify = uniqueId(workflow, 'edge', [notifyId, endId]);
    const toEnd = uniqueId(workflow, 'edge', [notifyId, endId, toNotify]);
    const base = analyze.position ?? { x: 250, y: 200 };
    const summary = 'Escalate critical CVEs to the on-call engineer';
    return { message: `${summary}: after "${analyze.name}", critical severities page on-call and end as "Escalated".`,
        changeSet: changeSet(revision, summary, [
            { op: 'addNode', node: { id: notifyId, type: 'action', name: 'Page On-call', position: { x: base.x + 250, y: base.y + 220 },
                config: { actionType: 'send-email', inputs: { to: "'oncall@example.com'", subject: "'Critical CVE: ' += context.cveId" },
                    outputs: [{ name: 'messageId', type: 'string', required: true }] } } },
            { op: 'addNode', node: { id: endId, type: 'end', name: 'Escalated', position: { x: base.x + 500, y: base.y + 220 }, config: {} } },
            // A conditional branch needs the existing unconditional route to become the default.
            ...workflow.edges.filter(edge => edge.source === 'analyze' && !edge.condition && !edge.isDefault)
                .map((edge): ChangeOp => ({ op: 'updateEdge', id: edge.id, patch: { isDefault: true } })),
            { op: 'addEdge', edge: { id: toNotify, source: 'analyze', target: notifyId, condition: "context.severity == 'critical'",
                priority: 1, isDefault: false, label: 'Critical' } },
            { op: 'addEdge', edge: { id: toEnd, source: notifyId, target: endId, priority: 0, isDefault: false } },
        ]) };
}

/**
 * The demo's scripted AI agent. Deterministic and offline; it reads the workflow and returns a reply, possibly with a
 * change set based on `revision` (so it goes stale if the workflow changes before it is used).
 *
 * @param request what the user asked for
 * @param workflow the workflow the request was made against
 * @param revision that workflow's content revision
 * @returns the assistant's reply
 */
export function respond(request: AgentRequest, workflow: Workflow, revision: string): AgentResponse {
    switch (request.kind) {
        case 'add-wait': return addWait(workflow, revision, request.nodeId);
        case 'rename': return rename(workflow, revision, request.nodeId);
        case 'explain': return explain(workflow, request.nodeId);
        case 'add-notification': return addNotification(workflow, revision, request.position);
        case 'fix-problem': return fixProblem(workflow, request.problem);
        case 'add-error-handling': return addErrorHandling(workflow, revision);
    }
}
