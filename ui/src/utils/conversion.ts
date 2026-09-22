import {type Edge, MarkerType, type Node} from '@xyflow/react';
import {type Workflow, type WorkflowEdge, type WorkflowNode, type NodeConfigMap, type NodeType} from '../types/workflow.ts';
import {type ValidationProblem} from '../types/validation.ts';
import {type ParallelRole} from './parallelView.ts';

export type FlowNodeData = { [K in NodeType]: Record<string, unknown> & {
  name: string;
  nodeType: K;
  config: NodeConfigMap[K];
  validationProblems?: ValidationProblem[];
  /** Static fork/join role for the authoring hint, if any (editor only). */
  parallelRole?: ParallelRole;
  /** Wire fields retained for host extensions when converting back from the canvas. */
  definition?: WorkflowNode;
} }[NodeType];

/** Converts wire nodes to canvas nodes while retaining host extension fields for export. */
export function toReactFlowNodes(nodes: WorkflowNode[]): Node<FlowNodeData>[] {
  return nodes.map(node => ({
    id: node.id,
    type: node.type,
    position: node.position ?? { x: 0, y: 0 },
    data: {
      name: node.name,
      nodeType: node.type,
      config: node.config,
      definition: node,
    } as FlowNodeData, // Renaming the discriminant preserves the node/config correlation.
  }));
}

/** Converts wire edges to canvas edges while retaining host extension fields for export. */
export function toReactFlowEdges(edges: WorkflowEdge[]): Edge[] {
  return edges.map(edge => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    type: 'conditional',
    markerEnd: {
      type: MarkerType.ArrowClosed
    },
    data: {
      condition: edge.condition,
      priority: edge.priority,
      isDefault: edge.isDefault,
      label: edge.label,
      definition: edge,
    },
  }));
}

/** Applies edited canvas fields over the original node definition and its host extensions. */
export function toWorkflowNodes(nodes: Node<FlowNodeData>[]): WorkflowNode[] {
  return nodes.map(node => ({
    ...node.data.definition,
    id: node.id,
    type: node.data.nodeType,
    name: node.data.name,
    config: node.data.config,
    position: node.position,
  } as WorkflowNode)); // Renaming the discriminant preserves the nodeType/config correlation.
}

/** Applies edited canvas fields over the original edge definition and its host extensions. */
export function toWorkflowEdges(edges: Edge[]): WorkflowEdge[] {
  return edges.map(edge => ({
    ...(edge.data?.definition as WorkflowEdge | undefined),
    id: edge.id,
    source: edge.source,
    target: edge.target,
    condition: edge.data?.condition as string | undefined,
    priority: (edge.data?.priority as number) ?? 0,
    isDefault: (edge.data?.isDefault as boolean) ?? false,
    label: edge.data?.label as string | undefined,
  }));
}

/** Reassembles the edited graph without discarding host metadata from the base definition. */
export function toWorkflow(base: Pick<Workflow, 'id' | 'name' | 'description' | 'version'>, nodes: Node<FlowNodeData>[], edges: Edge[]): Workflow {
  return {
    ...base,
    nodes: toWorkflowNodes(nodes),
    edges: toWorkflowEdges(edges),
  };
}
