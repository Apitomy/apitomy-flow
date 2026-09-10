import { type Workflow, type WorkflowEdge, type WorkflowNode } from '../types/workflow.ts';
import {
  type DiffStatus,
  type DiffWarning,
  type WorkflowDiffResult,
  type NodeDiffRecord,
  type EdgeDiffRecord,
} from './workflowDiffTypes.ts';

function statusBucket(): WorkflowDiffResult['summary']['nodes'] {
  return { added: 0, removed: 0, changed: 0, cosmetic: 0, unchanged: 0 };
}

function bump(bucket: WorkflowDiffResult['summary']['nodes'], status: DiffStatus): void {
  bucket[status] += 1;
}

function duplicateWarnings(kind: 'node' | 'edge', ids: string[]): DiffWarning[] {
  const code = kind === 'node' ? 'DUPLICATE_NODE_ID' : 'DUPLICATE_EDGE_ID';
  return ids.map((id) => ({
    code,
    message: `Duplicate ${kind} id detected: ${id}. Diff results may be ambiguous.`,
  }));
}

function indexNodes(nodes: WorkflowNode[]): { map: Map<string, WorkflowNode>; duplicates: string[] } {
  const map = new Map<string, WorkflowNode>();
  const duplicates = new Set<string>();
  for (const node of nodes) {
    if (map.has(node.id)) {
      duplicates.add(node.id);
    }
    map.set(node.id, node);
  }
  return { map, duplicates: [...duplicates] };
}

function indexEdges(edges: WorkflowEdge[]): { map: Map<string, WorkflowEdge>; duplicates: string[] } {
  const map = new Map<string, WorkflowEdge>();
  const duplicates = new Set<string>();
  for (const edge of edges) {
    if (map.has(edge.id)) {
      duplicates.add(edge.id);
    }
    map.set(edge.id, edge);
  }
  return { map, duplicates: [...duplicates] };
}

function samePosition(a?: WorkflowNode, b?: WorkflowNode): boolean {
  if (!a || !b) {
    return false;
  }
  return a.position.x === b.position.x && a.position.y === b.position.y;
}

function nodeDiff(baseNode?: WorkflowNode, compareNode?: WorkflowNode): NodeDiffRecord {
  if (!baseNode && compareNode) {
    return { id: compareNode.id, status: 'added', compareNode, changes: [] };
  }
  if (baseNode && !compareNode) {
    return { id: baseNode.id, status: 'removed', baseNode, changes: [] };
  }

  const changes: string[] = [];
  if (baseNode!.type !== compareNode!.type) {
    changes.push('type');
  }
  if (baseNode!.name !== compareNode!.name) {
    changes.push('name');
  }
  if (JSON.stringify(baseNode!.config) !== JSON.stringify(compareNode!.config)) {
    changes.push('config');
  }
  if (!samePosition(baseNode, compareNode)) {
    changes.push('position');
  }

  const semanticChanges = changes.filter((field) => field !== 'position');
  const status: DiffStatus = semanticChanges.length > 0
    ? 'changed'
    : changes.length > 0
      ? 'cosmetic'
      : 'unchanged';

  return {
    id: compareNode!.id,
    status,
    baseNode,
    compareNode,
    changes,
  };
}

function edgeDiff(baseEdge?: WorkflowEdge, compareEdge?: WorkflowEdge): EdgeDiffRecord {
  if (!baseEdge && compareEdge) {
    return { id: compareEdge.id, status: 'added', compareEdge, changes: [] };
  }
  if (baseEdge && !compareEdge) {
    return { id: baseEdge.id, status: 'removed', baseEdge, changes: [] };
  }

  const changes: string[] = [];
  if (baseEdge!.source !== compareEdge!.source) {
    changes.push('source');
  }
  if (baseEdge!.target !== compareEdge!.target) {
    changes.push('target');
  }
  if (baseEdge!.condition !== compareEdge!.condition) {
    changes.push('condition');
  }
  if (baseEdge!.priority !== compareEdge!.priority) {
    changes.push('priority');
  }
  if (baseEdge!.isDefault !== compareEdge!.isDefault) {
    changes.push('isDefault');
  }
  if (baseEdge!.label !== compareEdge!.label) {
    changes.push('label');
  }

  const status: DiffStatus = changes.length > 0 ? 'changed' : 'unchanged';
  return {
    id: compareEdge!.id,
    status,
    baseEdge,
    compareEdge,
    changes,
  };
}

/** Compare two workflow definitions and classify node/edge differences. */
export function diffWorkflows(baseWorkflow: Workflow, compareWorkflow: Workflow): WorkflowDiffResult {
  const baseNodes = indexNodes(baseWorkflow.nodes);
  const compareNodes = indexNodes(compareWorkflow.nodes);
  const baseEdges = indexEdges(baseWorkflow.edges);
  const compareEdges = indexEdges(compareWorkflow.edges);

  const warnings: DiffWarning[] = [
    ...duplicateWarnings('node', baseNodes.duplicates),
    ...duplicateWarnings('node', compareNodes.duplicates),
    ...duplicateWarnings('edge', baseEdges.duplicates),
    ...duplicateWarnings('edge', compareEdges.duplicates),
  ];

  const nodeOrder = [...new Set([
    ...baseWorkflow.nodes.map((node) => node.id),
    ...compareWorkflow.nodes.map((node) => node.id),
  ])];
  const edgeOrder = [...new Set([
    ...baseWorkflow.edges.map((edge) => edge.id),
    ...compareWorkflow.edges.map((edge) => edge.id),
  ])];

  const nodes: Record<string, NodeDiffRecord> = {};
  const edges: Record<string, EdgeDiffRecord> = {};
  const nodeSummary = statusBucket();
  const edgeSummary = statusBucket();

  for (const id of nodeOrder) {
    const record = nodeDiff(baseNodes.map.get(id), compareNodes.map.get(id));
    nodes[id] = record;
    bump(nodeSummary, record.status);
  }

  for (const id of edgeOrder) {
    const record = edgeDiff(baseEdges.map.get(id), compareEdges.map.get(id));
    edges[id] = record;
    bump(edgeSummary, record.status);
  }

  return {
    nodeOrder,
    edgeOrder,
    nodes,
    edges,
    summary: {
      nodes: nodeSummary,
      edges: edgeSummary,
    },
    warnings,
  };
}

/** Resolve a human-readable workflow label for headers and summaries. */
export function resolveWorkflowLabel(workflow: Pick<Workflow, 'id' | 'name' | 'version'>): string {
  const trimmedName = workflow.name?.trim();
  if (trimmedName && workflow.version !== undefined) {
    return `${trimmedName} (v${workflow.version})`;
  }
  if (trimmedName) {
    return trimmedName;
  }
  return workflow.id;
}
