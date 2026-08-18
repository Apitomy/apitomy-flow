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

## Node Types

Every node has an `id`, `type`, `name`, `config` (type-specific configuration), and `position` (visual coordinates).

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

- **Config**: Pass-through — the engine does not interpret it. The consuming application defines the schema (e.g. title, description, form fields).
- **Behavior**: Completes when the consuming application calls `completeCurrentNode` with the human's response.

### Receive Event

Blocks until a matching external event arrives.

- **Config**: `eventType` (required) and `match` expressions (optional) for event correlation
- **Behavior**: Completes when the consuming application calls `completeCurrentNode` after a matching event is detected via `matchesEvent`

See [Event Correlation](event-correlation.md) for details.

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
| `currentNodeId` | String | The node the instance is currently at |
| `status` | Enum | `running`, `waiting`, `completed`, `failed`, `cancelled` |
| `context` | Map | Accumulated data from completed nodes |
| `history` | List | Record of visited nodes with timestamps and edge info |
| `failureReason` | String | Why the instance failed (null if not failed) |
| `createdOn` | Instant | When the instance was created |
| `updatedOn` | Instant | When the instance was last modified |

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
