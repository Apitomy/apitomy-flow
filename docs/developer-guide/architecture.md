# Architecture

This page describes the combined branch implementation; see
[current contracts](../user-guide/current-contracts.md) for release status and compatibility boundaries.

## Design principles

- **Stateless execution:** state in, updated state out. No persistence, background threads, or framework.
- **Host durability:** the host stores definitions and instance JSON, serializes concurrent deliveries,
  schedules timers, and provides idempotent external work.
- **Explicit wiring:** executors, listeners, and error handler are constructor dependencies.
- **Owned JSON snapshots:** nested maps/lists are read-only; Jackson trees are copied on ingress/read.
  Opaque Java objects remain host-owned immutable references. No-op calls may return the input instance.
- **Two expression environments:** Java uses Jakarta EL; browser simulation uses a verified subset.
  [Conformance limits](../user-guide/visual-editor.md#simulation-and-condition-testing) are explicit.

## Engine internals

### Public operations

| Category | Methods |
|---|---|
| Lifecycle | `startWorkflow`, `completeNode`, `completeCurrentNode`, `cancelWorkflow` |
| Correlation | `matchesEvent`, including a node-addressed overload |
| Expressions | `resolveExpression` |
| Parked-node info | `getActionInfo`, `getHumanTaskInfo`, `getReceiveEventInfo`, `getWaitInfo`; each has a node-addressed overload |

`startWorkflow` validates the definition and initial inputs. The call-local branch work queue then advances
all runnable branches until they park or the instance terminates. Calls and executor invocations are
synchronous; parallel tokens do not imply concurrent executor threads.

```text
Enter node → notify listener → resolve inputs / perform node work
  ACTION: invoke executor → COMPLETED / FAILED / PENDING
  HUMAN_TASK / RECEIVE_EVENT / WAIT: park for external completion
  END: complete the instance
Successful completion → validate/map output → history/context update → onNodeCompleted
  → choose priority/default edge OR dispatch all fork edges
  → onEdgeFollowed → join-arrival accounting / next node entry
```

Forks and joins are derived from validated topology, without dedicated node kinds. Join arrivals use
incoming edge IDs; each branch must reach its join through one distinct arrival edge. Unsupported crossing,
unbalanced, or cyclic regions are rejected before executors run. A fail-fast branch failure terminates the
instance; END terminates sibling work. See [Parallel Fork/Join](../user-guide/parallel-fork-join.md).

An action returning `PENDING` parks like other external-input nodes. Completing one node resumes that
branch, not unanswered siblings. Read-only info calls require an active parked node in a `WAITING`
instance. Recovery transitions share the 100-unit driver budget; action execution allows ten retries
after the initial attempt. These are call-local guards, not a durable backoff policy.

See [Engine errors](engine-errors.md) for structured failures and callback ordering, and
[indexed architecture](indexed-architecture.md) for graph indexes, value resolution, cache ownership,
and measured benchmark evidence.

### Validation and expressions

Both validators perform shape preflight before semantic traversal, followed by graph structure,
connectivity, conditions, semantic configuration, and parallel-region checks. Do not infer coverage from
a manually maintained rule total: codes may appear in several phases and severities depend on the failure.
[Validation](../user-guide/validation.md) links to the authoritative implementations and shared fixtures.

Java binds `context` for routing/input resolution and both `context` and `event` for event correlation and
output mappings. Blank conditions are unconditional; a conditional edge selects only boolean `true`.
The browser classifies expressions as supported, malformed subset syntax, or unsupported dialect.

## UI internals

```text
WorkflowEditor (ReactFlowProvider)
  useEditorState → editorReducer → owned document / past / future / presentation
  ReactFlow canvas + palette + context menu + import/export/image controls
  PropertiesPanel → node-kind forms + stable draft rows + value editors
  ProblemsPanel ← built-in + asynchronous host validation
  SimulationPanel → subset evaluator + branch-aware simulator
WorkflowViewer (ReactFlowProvider)
  read-only canvas + state/definition panel + visit/branch selection + host menu
WorkflowDiffViewer (ReactFlowProvider)
  ID-based comparison + combined canvas + field comparison panel
```

The editor initializes its graph from the mount prop. Subsequent metadata updates apply to that graph;
host-driven graph replacement requires a React `key` remount. Document commands commit atomically and
publish `onChange` once per committed revision. Selection, measurements, and drag frames are presentation
state. Semantic document identity excludes layout-only revisions, avoiding unnecessary validation and
parallel-analysis reruns. Import and undo/redo preserve workflow metadata with the graph.

Viewer and diff props update live; pass fresh object/array references rather than mutating them in place.
Neither component edits the host document. Layout can render definitions with absent positions.

Fast Vitest suites cover pure logic; [real-browser contracts](documentation-checks.md#browser-verification)
cover ReactFlow event ordering, focus, async host responses, and a packed-library consumer with CSS.
