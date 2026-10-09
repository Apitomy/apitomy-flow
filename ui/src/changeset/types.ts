import type { Workflow, WorkflowEdge, WorkflowNode } from '../types/workflow.ts';

/** Who produced a committed change: the person at the editor, the embedding host, or a named agent. */
export type Origin = 'user' | 'host' | `agent:${string}`;

/** Metadata delivered with every `onChange` notification. */
export interface ChangeMeta {
    /** Content revision of the published workflow (see `computeContentRevision`). */
    contentRevision: string;
    /** Origin of the change that produced this revision. */
    origin: Origin;
}

/** One serializable edit. Ops apply in order; later ops see the effects of earlier ops. */
export type ChangeOp =
    | { op: 'addNode'; node: WorkflowNode }
    | { op: 'updateNode'; id: string; patch?: { name?: string; config?: Record<string, unknown> }; unset?: string[] }
    | { op: 'renameNode'; id: string; newId: string }
    | { op: 'removeNode'; id: string }
    | { op: 'addEdge'; edge: WorkflowEdge }
    | { op: 'updateEdge'; id: string; patch?: Partial<Omit<WorkflowEdge, 'id'>>; unset?: string[] }
    | { op: 'removeEdge'; id: string }
    | { op: 'metadata'; patch: Partial<Pick<Workflow, 'name' | 'description' | 'version'>> };

/** An atomic, reviewable set of edits based on a specific content revision. */
export interface ChangeSet {
    id: string;
    /** The `contentRevision` the author based these ops on. */
    baseRevision: string;
    author: `agent:${string}` | 'host';
    summary: string;
    ops: ChangeOp[];
}

/** Stable, machine-readable failure codes shared with the Java engine. */
export type ChangeSetErrorCode =
    | 'target-missing' | 'duplicate-id' | 'edge-endpoint-missing' | 'malformed' | 'read-only' | 'stale';

/** Why a change set was rejected. `opIndex` is absent for whole-set failures such as `stale`. */
export interface ChangeSetError {
    code: ChangeSetErrorCode;
    opIndex?: number;
    reason: string;
}

/** Outcome of applying a change set to a workflow. */
export type ChangeSetResult = { ok: true; workflow: Workflow } | { ok: false; error: ChangeSetError };

/** How a staged proposal was resolved. */
export type ProposalOutcome = 'accepted' | 'rejected' | 'stale' | 'withdrawn';

/** The single proposal currently under review. */
export interface StagedProposal {
    changeSet: ChangeSet;
    /** The workflow as it would be after accepting. */
    preview: Workflow;
    stale: boolean;
}

/** A proposal resolution waiting to be published to the host. */
export interface ProposalEvent {
    seq: number;
    id: string;
    outcome: ProposalOutcome;
}

/** Elements added or modified by the most recently applied change set. */
export interface Highlight {
    nodeIds: string[];
    edgeIds: string[];
}
