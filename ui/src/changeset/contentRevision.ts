import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';
import type { Workflow, WorkflowNode } from '../types/workflow.ts';
import { canonicalJson } from './canonicalJson.ts';

/**
 * Returns a shallow copy of the workflow whose nodes carry no `position` (layout is not content).
 *
 * @param workflow the workflow to strip
 * @returns a copy without node positions; the input is not mutated
 */
export function stripLayout(workflow: Workflow): Workflow {
    return {
        ...workflow,
        nodes: workflow.nodes.map(node => {
            const copy: WorkflowNode = { ...node };
            delete copy.position;
            return copy;
        }),
    };
}

/**
 * Computes the content revision of a workflow: `sha256:` + hex SHA-256 of the RFC 8785 canonical JSON of
 * the workflow with layout stripped. Matches `io.apitomy.flow.changeset.ContentRevision` in the engine.
 *
 * @param workflow the workflow document
 * @returns the opaque revision string
 */
export function computeContentRevision(workflow: Workflow): string {
    return `sha256:${bytesToHex(sha256(utf8ToBytes(canonicalJson(stripLayout(workflow)))))}`;
}
