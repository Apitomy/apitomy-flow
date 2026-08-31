# Architecture

## Design Principles

- **Stateless engine** — the engine takes a workflow definition and instance state as input, returns updated state as output. No persistence, no background threads, no framework dependencies.
- **Consumer handles persistence** — the workflow instance is a single JSON document. The consuming application stores it however it chooses (database column, file, etc.).
- **Explicit wiring** — all dependencies (executors, listeners, error handler) are passed via constructor. No CDI, no service discovery, no classpath scanning.
- **Immutable state** — all engine methods return new `WorkflowInstance` objects. Input instances are never mutated.
- **One expression language** — Jakarta EL is used consistently for edge conditions and event correlation.

## Engine Internals

### WorkflowEngine

The central class. Three categories of methods:

| Category | Methods |
|----------|---------|
| Lifecycle | `startWorkflow`, `completeCurrentNode`, `cancelWorkflow` |
| Correlation | `matchesEvent` |
| Expression | `resolveExpression` |
| Introspection | `getHumanTaskInfo`, `getReceiveEventInfo`, `getWaitInfo` |
| (Internal) | `advance`, `executeActionNode`, `selectEdge` |

### Transition Loop

The `advance()` method is the core execution loop:

```
Node completes
  → fire onNodeCompleted
  → merge output into context
  → get outgoing edges (sorted by priority)
  → evaluate each condition (Jakarta EL)
  → select first match (or default)
  → fire onEdgeFollowed
  → record in history
  → fire onNodeEntered
  → execute target node:
      ACTION     → invoke executor, loop back
      HUMAN_TASK → set WAITING, return
      RECEIVE    → set WAITING, return
      END        → set COMPLETED, return
```

A safety limit of 100 transitions per call prevents infinite loops.

### Condition Evaluation

The `ConditionEvaluator` wraps Jakarta EL. Two modes:

| Context | Root Variables | Used For |
|---------|---------------|----------|
| Edge conditions | `context` | Routing decisions after node completion |
| Event matching | `context`, `event` | Correlating external events to waiting nodes |

Null or blank conditions evaluate to `true` (unconditional edges always match).

### Validation

The `WorkflowValidator` runs 51 rules across four categories:

1. **Structural** (26 rules) — graph integrity (start/end nodes, edge references, duplicates)
2. **Connectivity** (5 rules) — reachability, dead ends, isolated nodes
3. **Edge/Condition** (7 rules) — default edges, duplicate priorities, EL syntax
4. **Semantic** (13 rules) — event receivers, action types, input schemas, wait durations, automated cycles

`startWorkflow` runs the validator automatically and rejects definitions with ERROR-level problems.

## UI Internals

### Component Hierarchy

```
WorkflowEditor (ReactFlowProvider wrapper)
  └─ WorkflowEditorInner
       ├─ NodePalette (drag source for new nodes)
       ├─ ReactFlow canvas
       │    ├─ Custom node components (6 types)
       │    └─ ConditionalEdge component
       ├─ PropertiesPanel (node/edge config form)
       └─ ProblemsPanel (validation results)

WorkflowViewer (ReactFlowProvider wrapper)
  └─ WorkflowViewerInner
       └─ ReactFlow canvas (read-only, styled by instance state)
```

### Data Flow

The editor maintains internal React Flow state (`useNodesState`, `useEdgesState`) and converts between the `Workflow` model and React Flow's `Node[]`/`Edge[]` model using adapter functions in `utils/conversion.ts`.

```
Workflow (prop) → toReactFlowNodes/Edges → React Flow state
                                              ↓ (on change)
                                         toWorkflow → onChange callback
                                              ↓
                                         validateWorkflow → onValidationChange
```

### TypeScript Validator

A port of the Java `WorkflowValidator` implementing 49 of the 51 rules — it omits only `MISSING_EDGE_SOURCE` and `MISSING_EDGE_TARGET`, which the editor UI cannot produce. `INVALID_CONDITION` is included, using a lightweight balanced-token syntax check rather than a full Jakarta EL parse. Runs synchronously on every edit via `useMemo`. Host applications can contribute additional problems asynchronously through the editor SPI (see [Visual Editor](../user-guide/visual-editor.md)).
