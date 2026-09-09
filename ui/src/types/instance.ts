export type InstanceStatus = 'running' | 'waiting' | 'completed' | 'failed' | 'cancelled';

/** A live position in the workflow graph. Mirrors the Java {@code ActiveBranch} record. */
export interface ActiveBranch {
  branchId: string;
  nodeId: string;
}

export interface HistoryEntry {
  nodeId: string;
  nodeName: string;
  edgeId?: string;
  edgeCondition?: string;
  enteredOn: string;
  completedOn?: string;
  output?: Record<string, any>;
  /**
   * The branch this visit belongs to. The root (non-parallel) branch uses `"root"`; a missing value
   * also denotes the root, preserving back-compat for existing linear histories.
   */
  branchId?: string;
}

export interface WorkflowInstance {
  id: string;
  workflowId: string;
  /**
   * Derived, back-compat: the sole active node when exactly one branch is active, otherwise `null`
   * (when zero or multiple branches are active). Mirrors the engine's derived accessor.
   */
  currentNodeId: string | null;
  /** Concurrently active branch tokens. A non-parallel instance has exactly one (`"root"`). */
  activeBranches: ActiveBranch[];
  /** Per-join arrival record: incoming edge ids that have received a branch token, awaiting the rest. */
  joinArrivals: Record<string, string[]>;
  status: InstanceStatus;
  context: Record<string, any>;
  history: HistoryEntry[];
  failureReason?: string;
  createdOn: string;
  updatedOn: string;
}
