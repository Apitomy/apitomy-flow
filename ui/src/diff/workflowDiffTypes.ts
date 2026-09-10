import { type WorkflowEdge, type WorkflowNode } from '../types/workflow.ts';

export type DiffStatus = 'added' | 'removed' | 'changed' | 'cosmetic' | 'unchanged';

export interface DiffWarning {
  code: 'DUPLICATE_NODE_ID' | 'DUPLICATE_EDGE_ID';
  message: string;
}

export interface NodeDiffRecord {
  id: string;
  status: DiffStatus;
  baseNode?: WorkflowNode;
  compareNode?: WorkflowNode;
  changes: string[];
}

export interface EdgeDiffRecord {
  id: string;
  status: DiffStatus;
  baseEdge?: WorkflowEdge;
  compareEdge?: WorkflowEdge;
  changes: string[];
}

export interface DiffSummaryBucket {
  added: number;
  removed: number;
  changed: number;
  cosmetic: number;
  unchanged: number;
}

export interface WorkflowDiffResult {
  nodeOrder: string[];
  edgeOrder: string[];
  nodes: Record<string, NodeDiffRecord>;
  edges: Record<string, EdgeDiffRecord>;
  summary: {
    nodes: DiffSummaryBucket;
    edges: DiffSummaryBucket;
  };
  warnings: DiffWarning[];
}
