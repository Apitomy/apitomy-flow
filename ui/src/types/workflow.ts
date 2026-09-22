export type NodeType = 'start' | 'end' | 'action' | 'human-task' | 'receive-event' | 'wait';

/** JSON values accepted in literal inputs, defaults, and host extension fields. */
export type JsonValue = null | boolean | number | string | JsonValue[] | JsonObject;
/** Undefined properties represent omitted fields when authored in TypeScript. */
export interface JsonObject { [key: string]: JsonValue | undefined }
/** Unknown config keys are host-owned JSON. Prefer namespaced keys such as `x-acme`. */
export type ConfigExtensions = JsonObject;

/** Reserved metadata on every input/output declaration; unknown keys remain host-owned JSON. */
export interface DeclarationMetadata extends ConfigExtensions {
    description?: string | null;
    label?: string | null;
    /** Advisory text on start/action declarations; human-task authoring offers supported widgets. */
    widget?: string | null;
    contextKey?: string | null;
    options?: OutputOption[] | null;
    defaultValue?: JsonValue;
}

export interface WorkflowInput extends DeclarationMetadata {
  name: string;
  type?: 'string' | 'number' | 'boolean' | 'object' | null;
  required?: boolean | null;
  description?: string | null;
}

/** Rendering hint for a human-task output field. Applies to `string`-typed outputs. */
export type OutputWidget = 'text' | 'textarea' | 'select';

/** A selectable choice for a human-task output rendered with the `select` widget. */
export interface OutputOption extends ConfigExtensions {
  /** Human-readable text shown to the person completing the task. */
  label?: string | null;
  /** Value stored in the workflow context when this option is chosen. */
  value?: string | null;
}

/**
 * A single form field a person fills in to complete a human-task node. Only `name` is required;
 * every other attribute is optional and backward-compatible. Consumed by hosts (e.g. Axiom) to
 * render the runtime completion form.
 */
export interface HumanTaskOutput extends DeclarationMetadata {
  /** Context key the answer is stored under. */
  name: string;
  /** Semantic type governing the stored value. Defaults to `string` when omitted. */
  type?: 'string' | 'number' | 'boolean' | 'object' | null;
  /** Whether the output must be provided to complete the task. Defaults to `false`. */
  required?: boolean | null;
  /** Human-readable field label. Defaults to `name` when omitted. */
  label?: string | null;
  /** Help/hint text shown under the field. */
  description?: string | null;
  /** Rendering hint. Inferred from `type` when omitted. */
  widget?: OutputWidget | null;
  /** Pre-filled value. */
  defaultValue?: JsonValue;
  /** Choices for `widget: 'select'`. */
  options?: OutputOption[] | null;
  /**
   * Optional override for the context key the answer is stored under. Defaults to `name` when
   * omitted. Useful to avoid collisions when the same action/human-task type is used more than
   * once in a workflow and both calls would otherwise write to the same context key.
   */
  contextKey?: string | null;
}

/**
 * An action node's declared output (`node.config.outputs` entries). Mirrors the shape read from
 * the action type descriptor (`ActionTypeField`), plus the per-node-instance `contextKey`
 * override.
 */
export interface ActionOutputConfig extends DeclarationMetadata {
  /** The output's declared name (as produced by the action executor). */
  name: string;
  type?: 'string' | 'number' | 'boolean' | 'object' | null;
  required?: boolean | null;
  /**
   * Optional override for the context key the value is stored under. Defaults to `name` when
   * omitted.
   */
  contextKey?: string | null;
}

/**
 * A single output mapping declared on a `receive-event` node: an EL `expression` (evaluated
 * against the `event` and `context` root beans) whose result is stored under `contextKey` when
 * the node's branch completes. When a receive-event node declares no mappings, its entire raw
 * event payload is flat-merged into context instead (unchanged legacy behavior).
 */
export interface EventOutputMapping extends ConfigExtensions {
  /** The context key the computed value is stored under. */
  contextKey?: string | null;
  /** The EL expression to evaluate, with `event` and `context` root beans available. */
  expression?: string | null;
}

export interface StartConfig extends ConfigExtensions {
    inputs?: WorkflowInput[] | null;
}
export type EndConfig = ConfigExtensions;
export interface ActionConfig extends ConfigExtensions {
    actionType?: string | null;
    inputs?: JsonObject | null;
    outputs?: ActionOutputConfig[] | null;
}
export interface HumanTaskConfig extends ConfigExtensions {
    description?: string | null;
    inputs?: JsonObject | null;
    outputs?: HumanTaskOutput[] | null;
}
export interface ReceiveEventConfig extends ConfigExtensions {
    eventType?: string | null;
    match?: string[] | null;
    outputs?: EventOutputMapping[] | null;
}
export interface WaitConfig extends ConfigExtensions {
    duration?: string | null;
}
export interface NodeConfigMap {
    start: StartConfig;
    end: EndConfig;
    action: ActionConfig;
    'human-task': HumanTaskConfig;
    'receive-event': ReceiveEventConfig;
    wait: WaitConfig;
}
export type NodeConfig = NodeConfigMap[NodeType];

/** Correlates each node kind with its built-in config, retaining host JSON extensions. */
export type WorkflowNode = {
    [K in NodeType]: {
        id: string;
        type: K;
        name: string;
        config: NodeConfigMap[K];
        position?: { x: number; y: number } | null;
    }
}[NodeType];

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
