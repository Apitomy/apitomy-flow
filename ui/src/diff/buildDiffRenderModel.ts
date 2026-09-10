import { type Workflow, type WorkflowEdge, type WorkflowNode } from '../types/workflow.ts';
import { type WorkflowDiffResult } from './workflowDiffTypes.ts';

export interface DiffRenderModel {
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
}

function preferredNode(baseNode?: WorkflowNode, compareNode?: WorkflowNode): WorkflowNode | undefined {
  if (compareNode && baseNode) {
    return { ...compareNode, position: compareNode.position ?? baseNode.position };
  }
  return compareNode ?? baseNode;
}

function preferredEdge(baseEdge?: WorkflowEdge, compareEdge?: WorkflowEdge): WorkflowEdge | undefined {
  return compareEdge ?? baseEdge;
}

/**
 * Build a render model for the diff graph from the union of node/edge ids.
 */
export function buildDiffRenderModel(
  baseWorkflow: Workflow,
  compareWorkflow: Workflow,
  diff: WorkflowDiffResult,
): DiffRenderModel {
  const baseNodeMap = new Map(baseWorkflow.nodes.map((node) => [node.id, node]));
  const compareNodeMap = new Map(compareWorkflow.nodes.map((node) => [node.id, node]));
  const baseEdgeMap = new Map(baseWorkflow.edges.map((edge) => [edge.id, edge]));
  const compareEdgeMap = new Map(compareWorkflow.edges.map((edge) => [edge.id, edge]));

  const nodes: WorkflowNode[] = diff.nodeOrder
    .map((id) => preferredNode(baseNodeMap.get(id), compareNodeMap.get(id)))
    .filter((node): node is WorkflowNode => !!node);

  const edges: WorkflowEdge[] = diff.edgeOrder
    .map((id) => preferredEdge(baseEdgeMap.get(id), compareEdgeMap.get(id)))
    .filter((edge): edge is WorkflowEdge => !!edge);

  return { nodes, edges };
}
