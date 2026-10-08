import type { Workflow, WorkflowEdge, WorkflowNode } from '../types/workflow.ts';
import { placeNewNodes } from '../layout/layoutWorkflow.ts';
import { computeContentRevision } from './contentRevision.ts';
import type { ChangeSet, ChangeSetErrorCode, ChangeSetResult } from './types.ts';

const NODE_TYPES = new Set(['start', 'end', 'action', 'human-task', 'receive-event', 'wait']);
const REQUIRED_EDGE_FIELDS = ['id', 'source', 'target', 'priority', 'isDefault'];
const METADATA_KEYS = new Set(['name', 'description', 'version']);

class OpFailure extends Error {
    constructor(readonly code: ChangeSetErrorCode, reason: string) {
        super(reason);
    }
}

function fail(code: ChangeSetErrorCode, reason: string): never {
    throw new OpFailure(code, reason);
}

type JsonRecord = Record<string, unknown>;
const isObject = (value: unknown): value is JsonRecord =>
    typeof value === 'object' && value !== null && !Array.isArray(value);
const isString = (value: unknown): value is string => typeof value === 'string' && value.length > 0;

function requireObject(value: unknown, label: string): JsonRecord {
    return isObject(value) ? value : fail('malformed', `${label} must be an object`);
}

function requireString(op: JsonRecord, key: string): string {
    const value = op[key];
    return isString(value) ? value : fail('malformed', `"${key}" must be a non-empty string`);
}

function optionalPatch(op: JsonRecord): JsonRecord {
    return op.patch === undefined ? {} : requireObject(op.patch, '"patch"');
}

function unsetList(op: JsonRecord): string[] {
    if (op.unset === undefined) return [];
    if (!Array.isArray(op.unset) || !op.unset.every(isString)) fail('malformed', '"unset" must be an array of strings');
    return op.unset as string[];
}

function findNode(draft: Workflow, id: string): WorkflowNode | undefined {
    return draft.nodes.find(node => node.id === id);
}

function requireEndpoints(draft: Workflow, source: string, target: string): void {
    for (const id of [source, target]) {
        if (!findNode(draft, id)) fail('edge-endpoint-missing', `Edge endpoint "${id}" does not exist`);
    }
}

function applyOp(draft: Workflow, raw: unknown): void {
    const op = requireObject(raw, 'Each op');
    switch (op.op) {
        case 'addNode': {
            const node = requireObject(op.node, '"node"');
            if (!isString(node.id) || typeof node.type !== 'string' || !NODE_TYPES.has(node.type)
                || !isString(node.name) || !isObject(node.config)) {
                fail('malformed', 'addNode requires a node with id, a known type, name and an object config');
            }
            if (findNode(draft, node.id as string)) fail('duplicate-id', `Node "${node.id}" already exists`);
            draft.nodes.push(structuredClone(node) as unknown as WorkflowNode);
            return;
        }
        case 'updateNode': {
            const id = requireString(op, 'id');
            const patch = optionalPatch(op);
            const unset = unsetList(op);
            const extra = Object.keys(patch).find(key => key !== 'name' && key !== 'config');
            if (extra) fail('malformed', `updateNode patch may only contain "name" and "config", not "${extra}"`);
            if (patch.name !== undefined && !isString(patch.name)) fail('malformed', '"patch.name" must be a non-empty string');
            const config = patch.config === undefined ? {} : requireObject(patch.config, '"patch.config"');
            const both = unset.find(key => Object.hasOwn(config, key));
            if (both) fail('malformed', `"${both}" appears in both patch.config and unset`);
            const node = findNode(draft, id) ?? fail('target-missing', `Node "${id}" does not exist`);
            if (patch.name !== undefined) node.name = patch.name as string;
            const merged: JsonRecord = { ...node.config, ...structuredClone(config) };
            for (const key of unset) delete merged[key];
            node.config = merged as WorkflowNode['config'];
            return;
        }
        case 'renameNode': {
            const id = requireString(op, 'id');
            const newId = requireString(op, 'newId');
            const node = findNode(draft, id) ?? fail('target-missing', `Node "${id}" does not exist`);
            if (newId === id) return;
            if (findNode(draft, newId)) fail('duplicate-id', `Node "${newId}" already exists`);
            node.id = newId;
            for (const edge of draft.edges) {
                if (edge.source === id) edge.source = newId;
                if (edge.target === id) edge.target = newId;
            }
            return;
        }
        case 'removeNode': {
            const id = requireString(op, 'id');
            if (!findNode(draft, id)) fail('target-missing', `Node "${id}" does not exist`);
            draft.nodes = draft.nodes.filter(node => node.id !== id);
            draft.edges = draft.edges.filter(edge => edge.source !== id && edge.target !== id);
            return;
        }
        case 'addEdge': {
            const edge = requireObject(op.edge, '"edge"');
            if (!isString(edge.id) || !isString(edge.source) || !isString(edge.target)
                || typeof edge.priority !== 'number' || typeof edge.isDefault !== 'boolean') {
                fail('malformed', 'addEdge requires id, source, target, a numeric priority and a boolean isDefault');
            }
            if (draft.edges.some(existing => existing.id === edge.id)) fail('duplicate-id', `Edge "${edge.id}" already exists`);
            requireEndpoints(draft, edge.source as string, edge.target as string);
            draft.edges.push(structuredClone(edge) as unknown as WorkflowEdge);
            return;
        }
        case 'updateEdge': {
            const id = requireString(op, 'id');
            const patch = optionalPatch(op);
            const unset = unsetList(op);
            if (Object.hasOwn(patch, 'id')) fail('malformed', 'updateEdge patch may not change "id"');
            const required = unset.find(key => REQUIRED_EDGE_FIELDS.includes(key));
            if (required) fail('malformed', `"${required}" is required and cannot be unset`);
            const both = unset.find(key => Object.hasOwn(patch, key));
            if (both) fail('malformed', `"${both}" appears in both patch and unset`);
            if ((Object.hasOwn(patch, 'source') && !isString(patch.source)) || (Object.hasOwn(patch, 'target') && !isString(patch.target))
                || (Object.hasOwn(patch, 'priority') && typeof patch.priority !== 'number')
                || (Object.hasOwn(patch, 'isDefault') && typeof patch.isDefault !== 'boolean')) {
                fail('malformed', 'updateEdge patch has a field of the wrong type');
            }
            const index = draft.edges.findIndex(edge => edge.id === id);
            if (index < 0) fail('target-missing', `Edge "${id}" does not exist`);
            const merged: JsonRecord = { ...draft.edges[index], ...structuredClone(patch) };
            for (const key of unset) delete merged[key];
            requireEndpoints(draft, merged.source as string, merged.target as string);
            draft.edges[index] = merged as unknown as WorkflowEdge;
            return;
        }
        case 'removeEdge': {
            const id = requireString(op, 'id');
            if (!draft.edges.some(edge => edge.id === id)) fail('target-missing', `Edge "${id}" does not exist`);
            draft.edges = draft.edges.filter(edge => edge.id !== id);
            return;
        }
        case 'metadata': {
            const patch = requireObject(op.patch, '"patch"');
            const extra = Object.keys(patch).find(key => !METADATA_KEYS.has(key));
            if (extra) fail('malformed', `metadata patch may only contain name, description and version, not "${extra}"`);
            if ((Object.hasOwn(patch, 'name') && !isString(patch.name)) || (Object.hasOwn(patch, 'description') && typeof patch.description !== 'string')
                || (Object.hasOwn(patch, 'version') && typeof patch.version !== 'number')) {
                fail('malformed', 'metadata patch has a field of the wrong type');
            }
            Object.assign(draft, structuredClone(patch));
            return;
        }
        default:
            fail('malformed', `Unknown op "${String(op.op)}"`);
    }
}

/**
 * Applies every op of a change set atomically. Positionless added nodes are placed with `placeNewNodes`.
 * Does not check `baseRevision`; see {@link applyChangeSetChecked}.
 *
 * @param workflow the workflow to change; never mutated
 * @param changeSet the change set to apply
 * @returns the changed workflow, or the first failure with its op index
 */
export function applyChangeSet(workflow: Workflow, changeSet: ChangeSet): ChangeSetResult {
    if (!isObject(changeSet) || !Array.isArray(changeSet.ops)) {
        return { ok: false, error: { code: 'malformed', reason: 'A change set must have an "ops" array' } };
    }
    const draft = structuredClone(workflow);
    for (const [opIndex, op] of changeSet.ops.entries()) {
        try {
            applyOp(draft, op);
        } catch (error) {
            if (error instanceof OpFailure) return { ok: false, error: { code: error.code, opIndex, reason: error.message } };
            throw error;
        }
    }
    return { ok: true, workflow: placeNewNodes(draft) };
}

/**
 * Applies a change set only if its `baseRevision` equals the workflow's current content revision.
 *
 * @param workflow the workflow to change; never mutated
 * @param changeSet the change set to apply
 * @param currentRevision the workflow's revision when already known (avoids rehashing)
 * @returns the result, or a `stale` error without `opIndex`
 */
export function applyChangeSetChecked(workflow: Workflow, changeSet: ChangeSet,
    currentRevision: string = computeContentRevision(workflow)): ChangeSetResult {
    if (isObject(changeSet) && changeSet.baseRevision !== currentRevision) {
        return { ok: false, error: { code: 'stale',
            reason: `Change set is based on ${String(changeSet.baseRevision)} but the workflow is at ${currentRevision}` } };
    }
    return applyChangeSet(workflow, changeSet);
}
