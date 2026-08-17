import { type Node, type Edge } from '@xyflow/react';
import { type WorkflowNode, type WorkflowEdge, type Workflow } from '../types/workflow.ts';

export interface FlowNodeData extends Record<string, unknown> {
  name: string;
  nodeType: WorkflowNode['type'];
  config: Record<string, any>;
  validationSeverity?: 'error' | 'warning';
}

export function toReactFlowNodes(nodes: WorkflowNode[]): Node<FlowNodeData>[] {
  return nodes.map(node => ({
    id: node.id,
    type: node.type,
    position: node.position,
    data: {
      name: node.name,
      nodeType: node.type,
      config: node.config,
    },
  }));
}

export function toReactFlowEdges(edges: WorkflowEdge[]): Edge[] {
  return edges.map(edge => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    type: 'conditional',
    data: {
      condition: edge.condition,
      priority: edge.priority,
      isDefault: edge.isDefault,
      label: edge.label,
    },
  }));
}

export function toWorkflowNodes(nodes: Node<FlowNodeData>[]): WorkflowNode[] {
  return nodes.map(node => ({
    id: node.id,
    type: node.data.nodeType,
    name: node.data.name,
    config: node.data.config,
    position: node.position,
  }));
}

export function toWorkflowEdges(edges: Edge[]): WorkflowEdge[] {
  return edges.map(edge => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    condition: edge.data?.condition as string | undefined,
    priority: (edge.data?.priority as number) ?? 0,
    isDefault: (edge.data?.isDefault as boolean) ?? false,
    label: edge.data?.label as string | undefined,
  }));
}

export function toWorkflow(id: string, name: string, nodes: Node<FlowNodeData>[], edges: Edge[]): Workflow {
  return {
    id,
    name,
    nodes: toWorkflowNodes(nodes),
    edges: toWorkflowEdges(edges),
  };
}
