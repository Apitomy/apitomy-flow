export type NodeType = 'start' | 'end' | 'action' | 'human-task' | 'receive-event' | 'wait';

export interface WorkflowInput {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'object';
  required: boolean;
  description?: string;
}

/** Rendering hint for a human-task output field. Applies to `string`-typed outputs. */
export type OutputWidget = 'text' | 'textarea' | 'select';

/** A selectable choice for a human-task output rendered with the `select` widget. */
export interface OutputOption {
  /** Human-readable text shown to the person completing the task. */
  label: string;
  /** Value stored in the workflow context when this option is chosen. */
  value: string;
}

/**
 * A single form field a person fills in to complete a human-task node. Only `name` is required;
 * every other attribute is optional and backward-compatible. Consumed by hosts (e.g. Axiom) to
 * render the runtime completion form.
 */
export interface HumanTaskOutput {
  /** Context key the answer is stored under. */
  name: string;
  /** Semantic type governing the stored value. Defaults to `string` when omitted. */
  type?: 'string' | 'number' | 'boolean' | 'object';
  /** Whether the output must be provided to complete the task. Defaults to `false`. */
  required?: boolean;
  /** Human-readable field label. Defaults to `name` when omitted. */
  label?: string;
  /** Help/hint text shown under the field. */
  description?: string;
  /** Rendering hint. Inferred from `type` when omitted. */
  widget?: OutputWidget;
  /** Pre-filled value. */
  defaultValue?: unknown;
  /** Choices for `widget: 'select'`. */
  options?: OutputOption[];
  /**
   * Optional override for the context key the answer is stored under. Defaults to `name` when
   * omitted. Useful to avoid collisions when the same action/human-task type is used more than
   * once in a workflow and both calls would otherwise write to the same context key.
   */
  contextKey?: string;
}

/**
 * An action node's declared output (`node.config.outputs` entries). Mirrors the shape read from
 * the action type descriptor (`ActionTypeField`), plus the per-node-instance `contextKey`
 * override.
 */
export interface ActionOutputConfig {
  /** The output's declared name (as produced by the action executor). */
  name: string;
  type: 'string' | 'number' | 'boolean' | 'object';
  required?: boolean;
  /**
   * Optional override for the context key the value is stored under. Defaults to `name` when
   * omitted.
   */
  contextKey?: string;
}

/**
 * A single output mapping declared on a `receive-event` node: an EL `expression` (evaluated
 * against the `event` and `context` root beans) whose result is stored under `contextKey` when
 * the node's branch completes. When a receive-event node declares no mappings, its entire raw
 * event payload is flat-merged into context instead (unchanged legacy behavior).
 */
export interface EventOutputMapping {
  /** The context key the computed value is stored under. */
  contextKey: string;
  /** The EL expression to evaluate, with `event` and `context` root beans available. */
  expression: string;
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
