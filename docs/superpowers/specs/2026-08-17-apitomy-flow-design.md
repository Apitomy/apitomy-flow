# Apitomy Flow — Design Spec

A lightweight, stateless workflow engine library and visual editor for orchestrating long-running project lifecycles. Designed as a standalone library that integrates into Apitomy products (starting with Axiom).

## Architecture Overview

Two independent build roots, side by side:

```
apitomy-flow/
  engine/                          (Java — Maven module)
    pom.xml
    src/main/java/io/apitomy/flow/
      model/
      engine/
      spi/
    src/test/java/io/apitomy/flow/
  ui/                              (React — npm project)
    package.json
    tsconfig.json
    vite.config.ts
    src/
      components/
      types/
      index.ts
  PLAN.md
```

- **`engine/`** — Single Maven module. Artifact: `io.apitomy:apitomy-flow-engine`. Java 25. Pure Java library — no CDI, no Quarkus, no framework dependency. No JPA, no persistence — the engine is a stateless processor. All dependencies (executors, listeners, error handler) are passed explicitly via constructor. Fires events via `WorkflowEventListener` for observability.
- **`ui/`** — React component library. Not a standalone app. Exports editor and viewer components for the consuming application to render.

## Engine

### Core Model

Plain Java classes, Jackson-serializable. No JPA annotations — these get stored as JSON by the consumer.

#### Workflow Definition

| Class | Fields | Purpose |
|-------|--------|---------|
| `Workflow` | `id: String`, `name: String`, `description: String`, `nodes: List<WorkflowNode>`, `edges: List<WorkflowEdge>` | The full workflow graph definition |
| `WorkflowNode` | `id: String`, `type: NodeType`, `name: String`, `config: Map<String, Object>`, `position: Position` | A single node in the graph |
| `WorkflowEdge` | `id: String`, `source: String`, `target: String`, `condition: String`, `priority: int`, `isDefault: boolean`, `label: String` | A directed edge between two nodes |
| `NodeType` | enum: `START`, `END`, `ACTION`, `HUMAN_TASK`, `RECEIVE_EVENT` | The five supported node types |
| `Position` | `x: double`, `y: double` | Visual editor coordinates |

#### Workflow Instance (Runtime State)

| Class | Fields | Purpose |
|-------|--------|---------|
| `WorkflowInstance` | `id: String`, `workflowId: String`, `currentNodeId: String`, `status: InstanceStatus`, `context: Map<String, Object>`, `history: List<HistoryEntry>`, `failureReason: String`, `createdOn: Instant`, `updatedOn: Instant` | Current state of a running workflow |
| `InstanceStatus` | enum: `RUNNING`, `WAITING`, `COMPLETED`, `FAILED`, `CANCELLED` | Lifecycle status of an instance |
| `HistoryEntry` | `nodeId: String`, `nodeName: String`, `edgeId: String`, `edgeCondition: String`, `enteredOn: Instant`, `completedOn: Instant`, `output: Map<String, Object>` | Record of a visited node and the edge followed to reach it |

The `WorkflowInstance` is the single JSON state document. The consumer serializes it and stores it however they choose (database column, file, etc.).

- **`id`** — generated as `UUID.randomUUID().toString()` by default. An overloaded `startWorkflow` method accepts a caller-provided ID for cases where the consumer needs deterministic or externally-assigned IDs.
- **`failureReason`** — populated when the instance transitions to `FAILED` status. Contains a human-readable description of what went wrong (exception message, "no matching edge", etc.). Null when the instance is not failed.
- **`HistoryEntry.edgeId` / `edgeCondition`** — the edge that was followed to reach this node, and the condition expression that matched (if any). Null for the start node's first entry. Useful for debugging why a workflow took a particular path.

### Node Types

| Node Type | Behavior |
|-----------|----------|
| **Start** | Entry point. One per workflow. Config defines expected inputs. Validates initial context, then transitions to the next node. Supports multiple conditional outgoing edges evaluated against the initial context. |
| **Action** | Automated work. Invokes a `NodeExecutor`. Blocks until the executor returns a result. Result merges into context. |
| **Human Task** | Blocks until a human responds. Config is pass-through (see below). |
| **Receive Event** | Blocks until a matching event arrives. Config includes event type and field match criteria (see Event Correlation). |
| **End** | Terminal state. Marks the instance as completed. Config is pass-through (see below). |

**Pass-through configs:** The engine does not interpret human-task or end node configs. They are stored as-is in the node's `config` map and made available to the consuming application. For example, the consuming application defines what fields a human-task config contains (title, description, form schema, etc.) and uses them to render a task UI. Similarly, end node config can carry outcome metadata (success/failure, reason) that the consuming application reads after the workflow completes. The schemas for these configs are defined by the consuming application, not by the engine.

### Start Node Input Schema

The start node's `config` defines the expected inputs for the workflow. These inputs become the initial workflow context and are available to edge conditions and node executors throughout execution.

**Start node config:**
```json
{
  "inputs": [
    { "name": "cveId", "type": "string", "required": true, "description": "CVE identifier to triage" },
    { "name": "repository", "type": "string", "required": true, "description": "Target repository" },
    { "name": "severity", "type": "string", "required": false, "description": "Initial severity assessment" }
  ]
}
```

**Input field properties:**

| Field | Type | Required | Purpose |
|-------|------|----------|---------|
| `name` | String | yes | Key in the workflow context |
| `type` | String | yes | Data type: `string`, `number`, `boolean`, `object` |
| `required` | boolean | yes | Whether the input must be provided |
| `description` | String | no | Human-readable description (shown in editor and documentation) |

**Engine behavior in `startWorkflow`:**
1. Read the start node's `config.inputs`
2. Validate the provided `initialContext` against the input schema:
   - All `required` inputs must be present and non-null
   - If validation fails, throw an exception (workflow does not start)
   - The `type` field is informational — the engine validates presence only, not type correctness. The `type` field is used by the visual editor to render appropriate form inputs when starting a workflow.
3. The validated inputs become the initial `WorkflowInstance.context`
4. Evaluate the start node's outgoing edge conditions against this context
5. Transition to the matching edge's target node

This enables conditional start routing — e.g. a workflow that takes different initial paths based on severity:
```
Start (inputs: cveId, repository, severity)
  → [context.severity == 'critical'] Action(emergency-triage)
  → [default] Action(standard-triage)
```

### Event Correlation

When an external event arrives, the consuming application needs to determine which (if any) workflow instances are waiting for it and dispatch accordingly. Since the engine is stateless, correlation is a shared responsibility:

**Consumer's responsibility:** Query their own storage to find instances with `status == WAITING`.

**Engine provides:** A `matchesEvent` method that checks whether an incoming event matches a waiting receive-event node's criteria.

```java
// On WorkflowEngine:
boolean matchesEvent(Workflow definition, WorkflowInstance instance, Map<String, Object> event)
```

Returns `true` if:
1. The instance is in `WAITING` status
2. The current node is a `receive-event` node
3. The event matches the node's match criteria (see below)

**Consumer's correlation flow:**
1. Event arrives → query storage for all `WAITING` instances
2. For each candidate, call `matchesEvent(definition, instance, event)`
3. For matches, call `completeCurrentNode(definition, instance, result)` to advance the workflow

#### Receive-Event Node Config

The `config` map for a receive-event node uses a structured match criteria:

```json
{
  "eventType": "pr-merged",
  "match": [
    "event.repository == context.repository",
    "event.pull_request.number == context.prNumber"
  ]
}
```

- **`eventType`** (required) — exact string match against the event's `type` field. If the event's type doesn't match, the event is rejected without checking field criteria.
- **`match`** (optional) — a list of Jakarta EL expressions that must all evaluate to `true` for the event to correlate (AND semantics). The EL evaluation context exposes two root objects:
  - **`context`** — the workflow context (accumulated data from completed nodes)
  - **`event`** — the incoming event payload

This uses the same Jakarta EL engine as edge condition evaluation, keeping one expression language throughout the system. Edge conditions have `context` available; event match expressions additionally have `event`.

**Matching rules:**
- All expressions in `match` must evaluate to `true` (AND semantics). If `match` is absent or empty, any event of the correct type matches.
- Dot notation in EL expressions navigates nested maps automatically (e.g. `event.pull_request.number` resolves through `event.get("pull_request").get("number")`).
- Expressions have access to the full EL feature set — equality, comparisons, boolean logic, null checks. For negation, use `!(expr)` in the expression itself.

**Example — correlating a PR merge event:**

Workflow context (set by an earlier create-pr action node):
```json
{ "repository": "apitomy/axiom", "prNumber": 42 }
```

Receive-event node config:
```json
{
  "eventType": "pr-merged",
  "match": [
    "event.repository == context.repository",
    "event.pull_request.number == context.prNumber"
  ]
}
```

Incoming event:
```json
{
  "type": "pr-merged",
  "repository": "apitomy/axiom",
  "pull_request": { "number": 42 }
}
```

Result: both expressions evaluate to `true`. The event payload becomes the node result output and is merged into the workflow context.

### SPI: NodeExecutor

The host application implements `NodeExecutor` for each action type it supports (e.g. `"analyze-cve"`, `"create-pr"`, `"implement"`). Executors are passed to the `WorkflowEngine` constructor — no auto-discovery. The engine matches executors to action nodes by comparing `NodeExecutor.actionType()` against the node's `config.actionType` field.

```java
public interface NodeExecutor {
    String actionType();
    NodeResult execute(NodeExecutionContext context);  // synchronous — blocks until work is done
}

public record NodeExecutionContext(
    WorkflowNode node,
    Map<String, Object> workflowContext,
    Map<String, Object> nodeConfig
) {}

public record NodeResult(
    NodeResultStatus status,   // COMPLETED, FAILED
    Map<String, Object> output
) {}

public enum NodeResultStatus {
    COMPLETED, FAILED
}
```

Only action nodes use `NodeExecutor`. Human-task and receive-event nodes are handled directly by the engine (transition to `WAITING` status). Start and end nodes have no executor.

**Action node config** must include an `actionType` field:
```json
{
  "actionType": "analyze-cve",
  "param1": "value1"
}
```

The engine looks up the executor whose `actionType()` matches, and passes the full config map as `nodeConfig` in the execution context.

### WorkflowEngine

Plain Java class. Stateless — takes state in, returns state out. **All methods are synchronous** and **return a new `WorkflowInstance`** — the input instance is never mutated. This prevents aliasing bugs where multiple references point to the same changing state. When the engine invokes a `NodeExecutor`, it blocks on the result. The consumer can run engine calls on a background thread if async behavior is desired.

Dependencies are provided via constructor:

```java
public WorkflowEngine(
    List<NodeExecutor> executors,
    List<WorkflowEventListener> listeners,
    WorkflowErrorHandler errorHandler  // optional, defaults to fail-the-workflow
)
```

**Public API:**

| Method | Input | Output | Behavior |
|--------|-------|--------|----------|
| `startWorkflow` | `Workflow definition`, `Map<String, Object> initialContext` | `WorkflowInstance` | Validates the definition (rejects with ERROR-level problems), validates the initial context against the start node's input schema (rejects if required inputs are missing), then creates a new instance (UUID id), executes the start node, and chains through subsequent nodes until a wait state or end is reached. |
| `startWorkflow` | `Workflow definition`, `Map<String, Object> initialContext`, `String instanceId` | `WorkflowInstance` | Same as above but with a caller-provided instance ID. |
| `completeCurrentNode` | `Workflow definition`, `WorkflowInstance instance`, `NodeResult result` | `WorkflowInstance` | Called when a human task or receive event completes. Merges result into context, evaluates outgoing edges, and chains through subsequent nodes until a wait state or end is reached. Throws `IllegalStateException` if the instance is not in `WAITING` status. |
| `cancelWorkflow` | `Workflow definition`, `WorkflowInstance instance` | `WorkflowInstance` | Cancels a running or waiting instance. Sets status to `CANCELLED`, fires `onWorkflowCancelled`. No-op if the instance is already in a terminal state (`COMPLETED`, `FAILED`, `CANCELLED`) — returns the instance unchanged. |
| `matchesEvent` | `Workflow definition`, `WorkflowInstance instance`, `Map<String, Object> event` | `boolean` | Checks if a waiting receive-event node's criteria match the incoming event. Used for event correlation. |

**Internal transition flow:**

1. Current node completes — fire `onNodeCompleted`, merge result output into `WorkflowInstance.context`
2. Retrieve outgoing edges from the current node, sorted by `priority`
3. Evaluate each edge's `condition` against the workflow context using Jakarta EL
4. Select the first matching edge (or the default edge) — fire `onEdgeFollowed`
5. Record the transition in `history` (including the edge ID and condition that matched)
6. Transition to the target node — fire `onNodeEntered`
7. Execute the target node:
   - **Action** → look up matching `NodeExecutor` by `actionType`, invoke it (blocking), loop back to step 1 with the result
   - **Human Task / Receive Event** → set status to `WAITING`, return the instance
   - **End** → set status to `COMPLETED`, fire `onWorkflowCompleted`, return the instance

**Chaining:** When an action node completes, the engine immediately evaluates edges and transitions to the next node. If the next node is also an action, it executes that too, continuing until it reaches a wait state (human-task, receive-event) or an end node. This means a single call to `startWorkflow` or `completeCurrentNode` may execute multiple action nodes in sequence.

**Safety limit:** The engine enforces a maximum number of transitions per call (default: 100) to prevent infinite loops from automated cycles. If the limit is reached, the engine fails the workflow with a descriptive `failureReason`.

### Condition Evaluation

Uses Jakarta Expression Language (Jakarta EL / JUEL). The same EL engine and variable access pattern is used for both edge conditions and event match criteria (see Event Correlation).

- Each edge's `condition` is an EL expression evaluated with `context` as the root variable
- The workflow context map is exposed as `context` — access nested values with dot notation: `context.result.status == 'affected'`
- Returns `true`/`false` — first edge whose condition returns `true` wins
- Edges with no condition always match
- The default edge is used as fallback when no conditioned edges match

Implemented as a `ConditionEvaluator` class that wraps the Jakarta EL API. All EL expressions throughout the system use `context` as the root variable for the workflow context, ensuring consistent syntax everywhere.

### Engine Events

The engine fires events during execution so consuming applications can log, audit, or react to workflow activity. Listeners are passed to the `WorkflowEngine` constructor.

```java
public interface WorkflowEventListener {
    void onWorkflowStarted(WorkflowInstance instance);
    void onNodeEntered(WorkflowInstance instance, WorkflowNode node);
    void onNodeCompleted(WorkflowInstance instance, WorkflowNode node, NodeResult result);
    void onEdgeFollowed(WorkflowInstance instance, WorkflowEdge edge);
    void onWorkflowCompleted(WorkflowInstance instance);
    void onWorkflowFailed(WorkflowInstance instance, Exception error);
    void onWorkflowCancelled(WorkflowInstance instance);
}
```

- **onWorkflowStarted** — fired at the beginning of `startWorkflow`, after validation passes but before the first node transition
- **onNodeEntered** — fired when the engine transitions into a node, before execution begins
- **onNodeCompleted** — fired after a node finishes (action completes, human task responded to, etc.)
- **onEdgeFollowed** — fired when the engine selects and follows an edge after condition evaluation
- **onWorkflowCompleted** — fired when the instance reaches an end node
- **onWorkflowFailed** — fired when the instance fails (node executor error, no matching edge, etc.)
- **onWorkflowCancelled** — fired when the instance is cancelled via `cancelWorkflow`

Multiple listeners can be registered. The engine calls all listeners but does not let a listener failure interrupt execution (errors are logged).

### Error Handling

Errors are handled via a `WorkflowErrorHandler` passed to the engine constructor. If none is provided, the engine uses a default handler that always fails the workflow.

```java
public interface WorkflowErrorHandler {
    ErrorResolution handleNodeError(WorkflowInstance instance, WorkflowNode node, NodeResult result, Exception error);
    ErrorResolution handleNoMatchingEdge(WorkflowInstance instance, WorkflowNode node);
}

public record ErrorResolution(
    ErrorAction action,     // FAIL, RETRY, TRANSITION
    String targetNodeId     // only used when action is TRANSITION
) {}

public enum ErrorAction {
    FAIL,        // fail the workflow instance
    RETRY,       // re-execute the current node
    TRANSITION   // jump to a specific node (e.g. an error-handling branch)
}
```

**Error scenarios:**
- **Node executor returns FAILED** → calls `handleNodeError(instance, node, result, null)` — the `result` contains the executor's output (which may include diagnostic info), `error` is null
- **Node executor throws** → calls `handleNodeError(instance, node, null, error)` — `result` is null, `error` is the thrown exception
- **No matching edge** (no condition matched, no default edge) → calls `handleNoMatchingEdge`
- **Condition evaluation fails** (bad EL expression) → treated as a node error
- **Error handler itself throws** → engine fails the workflow (prevents cascading failures)

The `TRANSITION` action lets consumers route to error-handling branches in the graph without needing special "error edge" concepts. If `TRANSITION` references a `targetNodeId` that doesn't exist in the workflow, the engine fails the workflow with a descriptive `failureReason`.

**Retry limits:** The engine does not enforce a retry count — the `WorkflowErrorHandler` is responsible for deciding when to stop retrying. A typical implementation tracks retry counts in the workflow context (e.g. incrementing `context.retryCount` on each `RETRY` resolution) and switches to `FAIL` or `TRANSITION` after a threshold. The engine's per-call transition safety limit (default: 100) provides a hard backstop against infinite retry loops.

### Workflow Validation

The engine provides a `WorkflowValidator` that checks a workflow definition for structural and semantic problems before execution. Returns a list of validation problems, each with a severity level.

```java
public class WorkflowValidator {
    List<ValidationProblem> validate(Workflow definition);
}

public record ValidationProblem(
    ValidationSeverity severity,  // ERROR, WARNING
    String code,                  // machine-readable code, e.g. "NO_START_NODE"
    String message,               // human-readable description
    String nodeId,                // optional: the node involved
    String edgeId                 // optional: the edge involved
) {}
```

**ERROR** — the workflow cannot execute. Must be fixed.
**WARNING** — the workflow can execute but the definition is likely wrong.

#### Validation Rules

**Structural (ERROR):**

| Code | Rule |
|------|------|
| `NO_START_NODE` | Exactly one start node is required |
| `MULTIPLE_START_NODES` | More than one start node found |
| `NO_END_NODE` | At least one end node is required |
| `INVALID_EDGE_SOURCE` | Edge references a source node ID that doesn't exist |
| `INVALID_EDGE_TARGET` | Edge references a target node ID that doesn't exist |
| `DUPLICATE_NODE_ID` | Two or more nodes share the same ID |
| `DUPLICATE_EDGE_ID` | Two or more edges share the same ID |
| `START_HAS_INCOMING` | Start node must not have incoming edges |
| `END_HAS_OUTGOING` | End node must not have outgoing edges |
| `MISSING_ACTION_TYPE` | Action node has no `actionType` in its config — engine cannot look up a matching executor |

**Connectivity (ERROR/WARNING):**

| Code | Severity | Rule |
|------|----------|------|
| `DISCONNECTED_NODE` | ERROR | Node has no incoming edges (except start) and no outgoing edges — completely isolated |
| `NO_OUTGOING_EDGES` | ERROR | Non-end node has no outgoing edges — execution would stall |
| `NO_INCOMING_EDGES` | WARNING | Non-start node has no incoming edges — node is unreachable |
| `UNREACHABLE_NODE` | WARNING | Node cannot be reached from the start node (graph traversal) |
| `NO_PATH_TO_END` | WARNING | Node has no path to any end node — execution could get stuck |

**Edge/Condition (WARNING):**

| Code | Rule |
|------|------|
| `NO_DEFAULT_EDGE` | Node has multiple conditional outgoing edges but no default — could stall if no condition matches |
| `MULTIPLE_DEFAULT_EDGES` | Node has more than one default outgoing edge — ambiguous fallback |
| `INVALID_CONDITION` | Edge condition is not syntactically valid EL (Java validator only — skipped in TypeScript) |
| `DUPLICATE_EDGE_PRIORITY` | Multiple outgoing edges from the same node share the same priority — evaluation order is ambiguous |

**Semantic (WARNING):**

| Code | Rule |
|------|------|
| `DUPLICATE_EVENT_RECEIVER` | Multiple receive-event nodes have identical `eventType` and `match` config — ambiguous event dispatch |
| `MISSING_EVENT_TYPE` | Receive-event node has no `eventType` configured |
| `UNCONDITIONAL_MULTIPLE_EDGES` | Node has multiple outgoing edges but none have conditions — only priority determines the path |
| `AUTOMATED_CYCLE` | Cycle detected that contains only action nodes (no human-task or receive-event) — could cause the engine to loop until the per-call transition safety limit is hit |
| `MISSING_START_INPUTS` | Start node has no inputs defined — workflow accepts no initial context, which is likely an oversight |

The validator is a standalone class with no dependencies on the engine — it can be used by both the backend and (via equivalent TypeScript logic) the UI editor to provide real-time validation feedback.

**TypeScript validator notes:** The TypeScript implementation covers all rules except `INVALID_CONDITION`, which requires parsing Jakarta EL expressions (a Java library). All other rules are structural or semantic checks that work identically in both languages.

### Build Configuration

- **GroupId:** `io.apitomy`
- **ArtifactId:** `apitomy-flow-engine`
- **Java:** 25
- **Jakarta EL** for condition evaluation
- **Jackson** for JSON serialization of model classes
- **JUnit 5** for tests

Pure Java library — no Quarkus, no CDI, no JPA, no framework dependencies. Can be used in any Java application.

### Testing

- JUnit 5 unit tests (no `@QuarkusTest` needed — no persistence layer)
- Mock `NodeExecutor` implementations for testing action node execution
- Test cases: workflow start, edge condition evaluation, node transitions, multi-step execution, error/failure paths, cycles (re-review loops)

## Visual Editor (React)

### Stack

- React 19, TypeScript, Vite
- `@xyflow/react` for the canvas
- PatternFly 6 for UI chrome (panels, forms, toolbars)
- `@apitomy/common-ui-components` for shared components

### Exported Components

| Component | Mode | Purpose |
|-----------|------|---------|
| `WorkflowEditor` | Edit | Drag-and-drop workflow definition builder. Full canvas with node palette, edge creation, and properties panel. |
| `WorkflowViewer` | Read-only | Visualizes a workflow instance. Highlights the current node and the path taken. |

### Component Structure

```
ui/src/
  components/
    WorkflowEditor.tsx             (top-level editor component)
    WorkflowViewer.tsx             (top-level read-only viewer)
    nodes/                         (custom React Flow node components per type)
    edges/                         (custom edge with condition badge)
    panels/                        (properties panel, node palette, problems panel)
  validation/                      (TypeScript port of WorkflowValidator rules)
  types/                           (TypeScript types mirroring the Java model)
  index.ts                         (public exports)
```

### Editor Features

- **Canvas:** Drag-and-drop node placement on a React Flow canvas
- **Node palette:** Toolbar or sidebar listing the five node types; drag to add
- **Edge creation:** Click source node → click target node to connect
- **Properties panel:** Side drawer for configuring the selected node (name, type-specific config) or edge (condition expression, priority, default flag, label)
- **Custom nodes:** Distinct visual treatment per node type (icon, color, shape)
- **Custom edges:** Display a small condition badge when a condition is set
- **Live validation:** Runs the workflow validator on every change and displays problems inline and in a summary panel (see below)

### Validation in the Editor

The editor runs a TypeScript implementation of the same validation rules as the Java `WorkflowValidator` on every edit. Feedback is immediate — no save-and-check cycle.

**Inline indicators:**
- Nodes with errors get a red border and error icon. Nodes with warnings get an amber border and warning icon.
- Edges with problems (invalid condition, duplicate priority) get a visual indicator on the edge or its condition badge.
- Hovering an indicator shows the validation message as a tooltip.

**Problems panel:**
- A collapsible panel (bottom or side) listing all current validation problems, grouped by severity (errors first, then warnings).
- Each entry shows the code, message, and the affected node/edge name.
- Clicking a problem selects and centers the affected node or edge on the canvas.

**Behavior:**
- Validation runs on every change (add/remove/edit node or edge). The rule set is lightweight enough for real-time execution.
- The editor can optionally expose an `onValidationChange` callback so the consuming application can react (e.g. disable a "Save" button when errors exist).

### Viewer Features

- **Read-only canvas:** Displays the workflow graph, not editable
- **Current node highlight:** The node where the instance is currently waiting is visually highlighted
- **Path taken:** Edges and nodes in the instance's history are styled to show the execution path

### TypeScript Types

Mirror the Java model for type safety.

**Definition types:**

```typescript
interface Workflow {
  id: string;
  name: string;
  description?: string;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
}

interface WorkflowNode {
  id: string;
  type: NodeType;
  name: string;
  config: Record<string, any>;
  position: { x: number; y: number };
}

interface WorkflowEdge {
  id: string;
  source: string;
  target: string;
  condition?: string;
  priority: number;
  isDefault: boolean;
  label?: string;
}

type NodeType = 'start' | 'end' | 'action' | 'human-task' | 'receive-event';

interface WorkflowInput {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'object';
  required: boolean;
  description?: string;
}
```

**Runtime types (used by WorkflowViewer):**

```typescript
interface WorkflowInstance {
  id: string;
  workflowId: string;
  currentNodeId: string;
  status: InstanceStatus;
  context: Record<string, any>;
  history: HistoryEntry[];
  failureReason?: string;
  createdOn: string;   // ISO 8601 timestamp
  updatedOn: string;
}

type InstanceStatus = 'running' | 'waiting' | 'completed' | 'failed' | 'cancelled';

interface HistoryEntry {
  nodeId: string;
  nodeName: string;
  edgeId?: string;
  edgeCondition?: string;
  enteredOn: string;
  completedOn?: string;
  output?: Record<string, any>;
}
```

**Validation types (used by the editor's validation module):**

```typescript
interface ValidationProblem {
  severity: ValidationSeverity;
  code: string;
  message: string;
  nodeId?: string;
  edgeId?: string;
}

type ValidationSeverity = 'error' | 'warning';
```

## Out of Scope (Deferred)

These items from the PLAN.md are explicitly deferred from the initial implementation:

- Workflow definition versioning and instance migration
- Restart/reset to a specific node
- JSON import/export of workflow definitions (the model is already JSON-serializable, but no dedicated UI for it)
- Parallel execution / fork-join nodes
