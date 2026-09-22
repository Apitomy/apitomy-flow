# Workflow Model

A workflow is a directed graph of **nodes** connected by **edges**. The graph defines the steps a process follows and the conditions that determine which path to take.

## Workflow Definition

| Field | Type | Description |
|-------|------|-------------|
| `id` | String | Unique identifier |
| `name` | String | Display name |
| `description` | String | Optional description |
| `nodes` | List | The nodes in the graph |
| `edges` | List | The edges connecting nodes |

Workflow definitions are JSON-serializable. The consuming application stores them however it chooses.

See [typed configuration and wire contract v1](typed-configuration.md) for the shared schema, per-node
TypeScript/Java APIs, host extension fields, defaults, and source-compatibility guidance.

## Node Types

Every node has an `id`, `type`, `name`, and `config` (type-specific configuration). `position` (visual
coordinates) is optional and nullable; the browser can lay out definitions that omit it.

### Start

Entry point for the workflow. One per workflow.

- **Config**: Defines expected inputs via an `inputs` array
- **Behavior**: Validates the initial context against the input schema, then transitions to the next node
- **Edges**: Supports multiple conditional outgoing edges evaluated against the initial context

```json
{
  "inputs": [
    { "name": "cveId", "type": "string", "required": true, "description": "CVE to triage" },
    { "name": "severity", "type": "string", "required": false }
  ]
}
```

### Action

Automated work delegated to a `NodeExecutor` provided by the host application.

- **Config**: Must include an `actionType` field matching a registered executor
- **Behavior**: Invokes the executor synchronously. Output merges into the workflow context.

```json
{
  "actionType": "analyze-cve",
  "param1": "value1"
}
```

### Human Task

Blocks until a human responds. The engine sets the instance to `WAITING` status.

- **Config**: The engine interprets three keys:
    - `description` (String) — instructions for the person completing the task
    - `inputs` (Map<String, String>) — map of display label to EL expression, resolved against the workflow context at render time (e.g. `{"Credit Score": "context.creditScore"}`)
    - `outputs` (List of `{name, type, required}`) — defines the form schema for task completion

  The validator emits `MISSING_TASK_DESCRIPTION` and `MISSING_TASK_OUTPUTS` warnings when these are absent.
- **Behavior**: Completes when the consuming application calls `completeCurrentNode` with the human's response.

### Receive Event

Blocks until a matching external event arrives.

- **Config**: `eventType` (required) and `match` expressions (optional) for event correlation
- **Behavior**: Completes when the consuming application calls `completeCurrentNode` after a matching event is detected via `matchesEvent`

See [Event Correlation](event-correlation.md) for details.

### Wait

Blocks for a configured duration. The engine sets the instance to `WAITING` status.

- **Config**: `duration` (String) — ISO 8601 duration (e.g. `PT30M`, `PT2H`, `P1D`). The validator emits `MISSING_WAIT_DURATION` if absent.
- **Behavior**: The consuming application reads the duration via `getWaitInfo`, schedules a timer, and calls `completeCurrentNode` when it expires.

### End

Terminal state. One or more per workflow.

- **Config**: Pass-through — typically carries outcome metadata (e.g. `"outcome": "mitigated"`)
- **Behavior**: Sets the instance to `COMPLETED` status

## Edges

Edges connect nodes and control the flow of execution.

| Field | Type | Description |
|-------|------|-------------|
| `id` | String | Unique identifier |
| `source` | String | Source node ID |
| `target` | String | Target node ID |
| `condition` | String | Jakarta EL expression (optional) |
| `priority` | int | Evaluation order — lower numbers first |
| `isDefault` | boolean | Fallback when no conditions match |
| `label` | String | Display label (optional) |

### Conditional Routing

When a node completes, the engine evaluates its outgoing edges:

1. Edges are sorted by `priority` (ascending)
2. Each edge's `condition` is evaluated against the workflow context using Jakarta EL
3. The first edge whose condition returns `true` is followed
4. If no condition matches, the `default` edge is followed
5. If no edge matches and there is no default, the error handler is invoked

Condition expressions use `context` as the root variable:

```
context.result.status == 'affected'
context.score > 80
context.approved && context.reviewCount >= 2
```

### Parallel Fork/Join

A node with **two or more outgoing edges that are all unconditional** (no `condition` and
`isDefault: false`) is a **fork**: entering it activates every outgoing branch concurrently, rather
than choosing one. This is the parallel counterpart to conditional routing, where exactly one edge is
taken.

```json
{ "id": "e-analyze", "source": "fetch-cve", "target": "analyze-impact", "priority": 0, "isDefault": false }
{ "id": "e-notify",  "source": "fetch-cve", "target": "notify-team",    "priority": 1, "isDefault": false }
```

The branches re-converge at a **join** — the first node reachable from every branch. A join behaves as
an **AND-join**: it waits for *all* incoming parallel branches to arrive before it fires, and it fires
exactly once. No special node type or config marks a join; it is identified statically from the graph
shape.

Fork/join regions must be well-formed:

- Every fork must have exactly one matching join (otherwise `FORK_WITHOUT_JOIN`).
- A parallel branch must not reach an `end` node before joining (otherwise
  `PARALLEL_BRANCH_REACHES_END`).
- A node's outgoing edges must be *all* unconditional (fork) or use conditions/a default (exclusive
  choice) — never a mix (otherwise `MIXED_FORK_EDGES`).

See [Validation](validation.md#parallel-structure-error) for the rules and
[the worked example](parallel-fork-join.md) for a complete fork/join workflow.

### Cycles

Edges can loop back to earlier nodes — this is intentional for retry/re-review patterns:

```
Human Task (approve plan)
  → [approved] Action (implement)
  → [rejected] Action (revise plan) → Human Task (approve plan)  // loop back
```

## Workflow Instance

A workflow instance is the runtime state of a workflow execution. It is a single JSON document — the consuming application handles persistence.

| Field | Type | Description |
|-------|------|-------------|
| `id` | String | Instance identifier (UUID by default) |
| `workflowId` | String | Reference to the workflow definition |
| `currentNodeId` | String \| null | The node the instance is currently at when exactly one branch is active; `null` when zero or multiple branches are active |
| `activeBranches` | Array | The branches currently executing, each `{ branchId, nodeId }`. A non-parallel run has a single `root` branch. |
| `joinArrivals` | Object | For each pending join node, the incoming edge ids that have already arrived and are waiting for the rest. |
| `status` | Enum | `running`, `waiting`, `completed`, `failed`, `cancelled` |
| `context` | Map | Accumulated data from completed nodes |
| `history` | List | Record of visited nodes with timestamps and edge info |
| `failureReason` | String | Why the instance failed (null if not failed) |
| `createdOn` | Instant | When the instance was created |
| `updatedOn` | Instant | When the instance was last modified |

When multiple branches are active, `currentNodeId` is `null` (it is a convenience for the
single-branch case). Each `HistoryEntry` carries an optional `branchId` tagging which branch made the
visit; a missing `branchId` denotes the `root` branch.

### Status Lifecycle

```
          ┌─────────┐
          │ RUNNING  │ ← startWorkflow / completeCurrentNode
          └────┬─────┘
               │
    ┌──────────┼──────────┐
    ▼          ▼          ▼
┌────────┐ ┌──────┐ ┌───────────┐
│WAITING │ │ END  │ │  ERROR    │
│        │ │      │ │           │
└───┬────┘ └──┬───┘ └─────┬─────┘
    │         │           │
    │    ┌────▼───┐  ┌────▼───┐
    │    │COMPLETED│  │ FAILED │
    │    └────────┘  └────────┘
    │
    ▼
┌──────────┐
│CANCELLED │ ← cancelWorkflow
└──────────┘
```
