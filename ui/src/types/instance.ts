export type InstanceStatus = 'running' | 'waiting' | 'completed' | 'failed' | 'cancelled';

export interface HistoryEntry {
  nodeId: string;
  nodeName: string;
  edgeId?: string;
  edgeCondition?: string;
  enteredOn: string;
  completedOn?: string;
  output?: Record<string, any>;
}

export interface WorkflowInstance {
  id: string;
  workflowId: string;
  currentNodeId: string;
  status: InstanceStatus;
  context: Record<string, any>;
  history: HistoryEntry[];
  failureReason?: string;
  createdOn: string;
  updatedOn: string;
}
