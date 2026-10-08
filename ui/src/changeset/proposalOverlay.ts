import type { Edge, Node } from '@xyflow/react';
import type { Workflow, WorkflowNode } from '../types/workflow.ts';
import { toReactFlowEdges, toReactFlowNodes, type FlowNodeData } from '../utils/conversion.ts';
import { jsonEqual } from '../utils/jsonEqual.ts';
import { changeStatus, type ChangeKind, type ChangeStatusMap } from './changeStatus.ts';
import type { ValidationDelta } from './validationDelta.ts';
import type { Highlight, StagedProposal } from './types.ts';

/** Canvas elements to render plus the classification used to build them (null without a proposal). */
export interface ProposalOverlay {
    nodes: Node<FlowNodeData>[];
    edges: Edge[];
    status: ChangeStatusMap | null;
}

type CountedKind = 'added' | 'modified' | 'removed';

/** Number of added, modified and removed nodes and edges. */
export interface ProposalCounts {
    nodes: Record<CountedKind, number>;
    edges: Record<CountedKind, number>;
}

/** Read-only before/after of one proposal element, without layout. */
export interface ProposalDetails {
    id: string;
    kind: 'node' | 'edge';
    before: unknown;
    after: unknown;
}

const withClass = (existing: string | undefined, extra: string) => [existing, extra].filter(Boolean).join(' ');

/**
 * Decorates the editor's canvas elements with the staged proposal (ghost additions, modified and removed
 * markers) or, with no proposal, with the applied-change highlight.
 *
 * @param nodes the editor's display nodes
 * @param edges the editor's display edges
 * @param document the current workflow
 * @param proposal the staged proposal, if any
 * @param highlight the applied-change highlight, if any and enabled
 * @returns the elements to hand to React Flow
 */
export function buildProposalOverlay(nodes: Node<FlowNodeData>[], edges: Edge[], document: Workflow,
    proposal: StagedProposal | null, highlight: Highlight | null): ProposalOverlay {
    if (!proposal) {
        if (!highlight) return { nodes, edges, status: null };
        const nodeIds = new Set(highlight.nodeIds);
        const edgeIds = new Set(highlight.edgeIds);
        return {
            nodes: nodes.map(node => nodeIds.has(node.id) ? { ...node, className: withClass(node.className, 'flow-applied') } : node),
            edges: edges.map(edge => edgeIds.has(edge.id) ? { ...edge, className: withClass(edge.className, 'flow-applied') } : edge),
            status: null,
        };
    }
    const status = changeStatus(document, proposal.preview);
    const stale = proposal.stale ? ' flow-proposal--stale' : '';
    const marker = (kind: ChangeKind | undefined) =>
        kind === 'modified' || kind === 'removed' ? `flow-proposal flow-proposal--${kind}${stale}` : undefined;
    const ghost = { draggable: false, deletable: false, connectable: false, selectable: false, focusable: false };
    return {
        nodes: [
            ...nodes.map(node => {
                const cls = marker(status.nodes[node.id]);
                return cls ? { ...node, className: withClass(node.className, cls) } : node;
            }),
            ...toReactFlowNodes(proposal.preview.nodes.filter(node => status.nodes[node.id] === 'added'))
                .map(node => ({ ...node, ...ghost, className: `flow-proposal flow-proposal--added${stale}` })),
        ],
        edges: [
            ...edges.map(edge => {
                const cls = marker(status.edges[edge.id]);
                return cls ? { ...edge, className: withClass(edge.className, cls) } : edge;
            }),
            ...toReactFlowEdges(proposal.preview.edges.filter(edge => status.edges[edge.id] === 'added'))
                .map(edge => ({ ...edge, deletable: false, selectable: false, focusable: false,
                    className: `flow-proposal flow-proposal--added${stale}` })),
        ],
        status,
    };
}

/**
 * Counts changed elements by kind.
 *
 * @param status the classification map
 * @returns the counts
 */
export function proposalCounts(status: ChangeStatusMap): ProposalCounts {
    const count = (map: Record<string, ChangeKind>) => {
        const result: Record<CountedKind, number> = { added: 0, modified: 0, removed: 0 };
        Object.values(map).forEach(kind => { if (kind !== 'unchanged') result[kind] += 1; });
        return result;
    };
    return { nodes: count(status.nodes), edges: count(status.edges) };
}

/**
 * Formats counts like `+1 node, +2 edges, ~1 node, −1 edge`.
 *
 * @param counts the counts
 * @returns the summary, or `No changes`
 */
export function formatCounts(counts: ProposalCounts): string {
    const parts: string[] = [];
    for (const [kind, symbol] of [['added', '+'], ['modified', '~'], ['removed', '−']] as const) {
        for (const what of ['nodes', 'edges'] as const) {
            const n = counts[what][kind];
            if (n) parts.push(`${symbol}${n} ${n === 1 ? what.slice(0, -1) : what}`);
        }
    }
    return parts.length ? parts.join(', ') : 'No changes';
}

/**
 * Describes a validation delta for the review bar.
 *
 * @param delta introduced and fixed problems
 * @returns a sentence such as `Introduces 2 problems, fixes 1 problem`
 */
export function validationText(delta: ValidationDelta): string {
    const plural = (n: number) => `${n} problem${n === 1 ? '' : 's'}`;
    const parts = [
        delta.introduced.length ? `introduces ${plural(delta.introduced.length)}` : '',
        delta.fixed.length ? `fixes ${plural(delta.fixed.length)}` : '',
    ].filter(Boolean);
    if (!parts.length) return 'No validation changes';
    const text = parts.join(', ');
    return text.charAt(0).toUpperCase() + text.slice(1);
}

function withoutPosition(node: WorkflowNode | undefined): unknown {
    if (!node) return null;
    const copy: WorkflowNode = { ...node };
    delete copy.position;
    return copy;
}

/**
 * Builds the before/after view of a node or edge touched by a proposal.
 *
 * @param document the current workflow
 * @param preview the proposed workflow
 * @param id a node or edge id
 * @returns the details, or null when the element is unknown or only moved
 */
export function proposalDetails(document: Workflow, preview: Workflow, id: string): ProposalDetails | null {
    const beforeNode = document.nodes.find(node => node.id === id);
    const afterNode = preview.nodes.find(node => node.id === id);
    if (beforeNode || afterNode) {
        const before = withoutPosition(beforeNode);
        const after = withoutPosition(afterNode);
        return jsonEqual(before, after) ? null : { id, kind: 'node', before, after };
    }
    const before = document.edges.find(edge => edge.id === id) ?? null;
    const after = preview.edges.find(edge => edge.id === id) ?? null;
    if (!before && !after) return null;
    return jsonEqual(before, after) ? null : { id, kind: 'edge', before, after };
}
