export type NodeType = 'start' | 'end' | 'action' | 'human-task' | 'receive-event' | 'wait';

export interface WorkflowInput {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'object';
  required: boolean;
  description?: string;
}

export interface WorkflowNode {
  id: string;
  type: NodeType;
  name: string;
  config: Record<string, any>;
  position: { x: number; y: number };
}

export interface WorkflowEdge {
  id: string;
  source: string;
  target: string;
  condition?: string;
  priority: number;
  isDefault: boolean;
  label?: string;
}

export interface Workflow {
  id: string;
  name: string;
  description?: string;
  version?: number;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
}
