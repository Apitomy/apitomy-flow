# Parallel Execution: Fork/Join (Concurrent Branches) — Design

**Date:** 2026-09-04
**Status:** Approved (design)
**Component:** `io.apitomy.flow` engine (Java) + `@apitomy/flow-ui` (`ui/`)
**Tracking:** [Apitomy/apitomy-flow#88](https://github.com/Apitomy/apitomy-flow/issues/88) (epic)

## Problem

Apitomy Flow can express only strictly sequential/branching flows: a `WorkflowInstance` tracks
exactly one `currentNodeId`, `advance()` is a single-cursor loop, and `selectEdge` chooses exactly
**one** outgoing edge per node. Real project lifecycles frequently need to do several things at once
and wait for all of them:

- "When a CVE is confirmed, **in parallel** analyze impact **and** notify the security team, then
  continue once both are done."
- "Kick off three independent remediation actions concurrently and wait for all before final
  sign-off."

Today authors must fake concurrency by serializing steps that have no ordering dependency (slower,
misrepresents intent) or by hiding the parallelism inside a single host action (opaque to the
workflow, invisible in the viewer, untestable as a graph). This is the single biggest structural
limitation separating Flow from a general-purpose orchestrator.

The single-active-node assumption is pervasive and must be lifted carefully. This document is the
**design spec only** — no code changes accompany it. It defines the model, execution semantics, join
semantics, validation, UI impact, and a phased implementation plan so that implementation can
proceed in reviewable increments with Java/TypeScript parity maintained throughout.

## Goals

- Let a workflow definition express that execution **fans out into multiple concurrent branches** and
  later **re-converges**.
- Represent instance state that can have **more than one active node at a time**, with history that
  records what happened on each branch.
- Define **wait-for-all (AND-join)** convergence semantics, including how failure/cancellation of one
  branch affects its siblings.
- Add editor/viewer support for authoring and visualizing concurrent branches, including showing
  multiple simultaneously-active nodes in a running instance.
- Keep **Java engine, TypeScript types, both validators (Java + TS), the TS simulation, and both UI
  components** in parity throughout the phased delivery.

## Non-Goals

Restating and extending the issue's out-of-scope list, plus decisions made below:

- **No dedicated `FORK`/`JOIN` node types.** Concurrency is inferred from edge shape (see Decisions).
- **No branch-scoped / namespaced context.** The flat, last-write-wins `context` map is retained; the
  concurrency hazard is documented, not engineered away.
- **No N-of-M / discriminator joins.** Only wait-for-all (AND-join) is defined now.
- **No unstructured / overlapping / cross-cutting parallel regions.** Parallelism must be
  *structured* (well-nested, balanced): every fork has exactly one matching join, branches do not
  cross region boundaries, and a branch may not reach `END` without first joining. Unstructured
  concurrency is a potential later capability, not part of this design.
- **No distributed / multi-process execution.** The engine remains a single, stateless component
  operating on one instance document.
- **No dynamic fan-out over a runtime collection** ("do this for each item in a list").
- **No sub-workflow / call-activity composition.** Tracked separately.

## Decisions

The following were decided for this design (see [#88](https://github.com/Apitomy/apitomy-flow/issues/88)):

| Decision | Choice | Rationale / alternatives rejected |
|----------|--------|-----------------------------------|
| **Graph modeling** | Reinterpret multiple edges (no new node types) | Minimal additions to `NodeType` and both node-component registries; a fork is just a node whose outgoing edges are all unconditional, a join is a multi-incoming convergence node. *Rejected:* dedicated `FORK`/`JOIN` types (more explicit but larger surface across enum, two `switch` blocks, palette, and node components) and a single `PARALLEL` gateway type. |
| **Join semantics** | Wait-for-all (AND-join) | Covers the motivating examples with the simplest, most predictable rule: continue once **all** converging branches arrive. *Deferred:* N-of-M / discriminator joins. |
| **Branch failure** | Fail-fast | Any branch that fails (or is cancelled) fails/cancels the whole workflow; remaining active branches are cancelled. Simplest deterministic policy consistent with wait-for-all. |
| **Context under concurrency** | Keep flat, last-write-wins; document the risk | No scoping. Concurrent writes to the same key resolve by execution order (deterministic under the single-threaded engine, but order-dependent). *Deferred:* branch-scoped context with merge-on-join. |
| **Structural discipline** | Structured (well-nested, balanced) parallelism, enforced by validation | Makes the AND-join firing rule simple and deterministic and keeps the blast radius bounded. Unstructured concurrency is a non-goal. |

## Model: inferring fork and join from edge shape

No changes to `NodeType`, `WorkflowNode`, or `WorkflowEdge` **shape**. Concurrency is derived from the
existing graph:

### Fork (parallel split)

A node is a **parallel fork** when it has **two or more outgoing edges and every outgoing edge is
unconditional** — i.e. no edge has a `condition`, and none is marked `isDefault`. Entering a fork node
activates **all** of its outgoing edges concurrently.

Disambiguation from the existing exclusive-choice behavior is purely by edge shape:

| Outgoing edges of a node | Meaning |
|--------------------------|---------|
| Exactly one edge | Sequential transition (unchanged). |
| ≥2 edges, **all** unconditional, none default | **Parallel fork** — activate all (NEW). |
| ≥2 edges with at least one `condition` and/or an `isDefault` | Exclusive choice — `selectEdge` picks one (unchanged). |
| ≥2 edges mixing unconditional (non-default) edges with conditional/default edges | **Invalid** — ambiguous (`MIXED_FORK_EDGES`, see Validation). |

This is a deliberate **behavior change**: the "≥2 unconditional edges" shape was previously only a
warning (`UNCONDITIONAL_MULTIPLE_EDGES`) because the engine silently took just one edge. That shape
now has defined fork semantics. Existing workflows relying on the old accidental single-edge behavior
were, by that warning, already flagged as suspect; the migration note and validator changes below
call this out explicitly.

### Join (synchronizing merge)

A **join** is the node where a fork's branches re-converge. Under structured parallelism, each fork
`F` has exactly one matching join `J`, determined statically as the nearest common convergence point
(post-dominator) of `F`'s successor branches. `J` is a normal node (any `NodeType` except `START`);
it simply has multiple incoming edges from the branches of `F`.

- A multi-incoming node that **is** the matching join of a fork behaves as an **AND-join**: it holds
  arriving branches and executes/continues only once **all** of that region's branches have arrived.
- A multi-incoming node that is **not** a fork's join (e.g. two mutually-exclusive conditional
  branches that merge) behaves as a **simple merge** — it executes on each arrival, exactly as today.

The static fork→join pairing is computed once (by the validator and reused by the engine/simulation)
so that runtime firing needs no whole-graph reasoning.

## Execution model

### Active-branch state (replaces the single cursor)

The instance gains a set of concurrently **active branches** (tokens). Conceptually:

```
Branch := { branchId: string, nodeId: string }   // a live position in the graph
```

- **Java** `WorkflowInstance` (`engine/.../model/WorkflowInstance.java`): add
  `List<ActiveBranch> activeBranches` (each `record ActiveBranch(String branchId, String nodeId)`).
  Retain `currentNodeId` as a **derived, back-compat accessor**: it returns the sole active node when
  exactly one branch is active, otherwise `null`. Existing single-path consumers and tests continue
  to work for non-parallel workflows.
- **TypeScript** `WorkflowInstance` (`ui/src/types/instance.ts`): mirror with
  `activeBranches: { branchId: string; nodeId: string }[]`; keep `currentNodeId` as the same derived
  value for wire parity.

`branchId` is a stable, engine-assigned identifier. The initial branch (from the start node) has a
well-known root id (e.g. `"root"`). A fork assigns child branch ids; a join collapses them back to a
single continuing branch (conventionally the id of the branch that reaches the join last, or the
matching fork's parent id — the exact scheme is an implementation detail fixed in Phase 1).

### The advance loop (token-based)

`WorkflowEngine.advance()` changes from a single `while(true)` cursor into a **work-queue over
runnable branches**:

1. Seed the queue with all currently-runnable branches (those at a node that can auto-advance).
2. While the queue is non-empty, pop a branch and advance it **one step**, which resolves the node at
   its position and its outgoing edges:
   - **Sequential** (one outgoing edge): move the branch to the edge target.
   - **Fork** (≥2 unconditional edges): retire this branch and enqueue one new child branch per
     outgoing edge, each positioned at that edge's target.
   - **Exclusive choice**: `selectEdge` as today; move the branch to the chosen target.
   - **Arriving at a join `J`**: *park* the branch at `J` against `J`'s incoming-edge set instead of
     executing. When branches have arrived covering **every** incoming edge of `J` (guaranteed by the
     structured-balance validation to be exactly the region's branches), collapse them into a single
     continuing branch, execute/continue `J`, and enqueue it.
   - **Blocking nodes** (`HUMAN_TASK`, `RECEIVE_EVENT`, `WAIT`, or an `ACTION` executor returning
     `PENDING`): the branch **parks** (see status) and is removed from the runnable queue; other
     branches keep running.
   - **`END`**: completes the **entire** workflow immediately (see Completion).
3. When no runnable branches remain, derive and persist the instance status.

The `MAX_TRANSITIONS` loop guard is retained but counts total steps across all branches.

The old invariant *"the last history entry is the current node"* (`hasEnteredCurrentNode`,
`completeCurrentHistoryEntry`) is removed. Completion of a node's history entry is matched by
`(branchId, nodeId)` against the open (not-yet-completed) entry for that branch, not by list position.

### AND-join firing rule

For the matching join `J` of a fork region: **`J` fires once a branch token has arrived on every
incoming edge of `J`.** Structured-balance validation guarantees that all of `J`'s incoming edges
belong to the one region, so "a token on every incoming edge" is exactly "all branches converged."
Nested forks resolve recursively — an inner join fires first, producing a single token that flows on
to the outer join. Arrived-but-waiting branches are held in instance state (a small per-join arrival
record) so the wait survives persistence between `advance()` calls.

### Completion, failure, cancellation, and waiting

- **COMPLETED:** reaching an `END` node completes the entire workflow immediately; any other active or
  parked branches are cancelled. Structured-balance validation guarantees a parallel branch cannot
  reach `END` without first joining, so this only fires on the single post-join path.
- **FAILED (fail-fast):** if any branch fails (executor failure with no recovering `TRANSITION`,
  unmatched edge, etc.), the whole workflow transitions to `FAILED` and all other active/parked
  branches are cancelled. `failureReason` records the failing branch.
- **CANCELLED:** `cancelWorkflow` cancels all active/parked branches.
- **WAITING:** when the runnable queue drains and at least one branch is parked on a blocking node,
  the instance is `WAITING`. Resuming targets a specific parked node:
  `completeNode(instance, nodeId, output)` (and event delivery) match the parked branch by `nodeId`
  (disambiguated by `branchId` in the rare case the same node is parked in more than one branch).
  Only that branch becomes runnable; siblings are unaffected.

Instance status is **derived** each time `advance()` reaches quiescence, in priority order:
`FAILED` → `CANCELLED` → `COMPLETED` → `WAITING` (≥1 parked branch) → otherwise `RUNNING` (transient
during a step).

### History with branch attribution

`HistoryEntry` gains an optional `branchId` (Java `record` field + TS type field). History remains a
single, time-ordered, append-only `List<HistoryEntry>`; concurrent branches interleave and are
distinguished by `branchId`. Consumers that group or replay history (viewer detail, `nodeHistory`
util) use `branchId` to attribute and group visits. Absent/`null` `branchId` denotes the root
(non-parallel) branch, preserving back-compat for existing linear histories.

## Concurrency and context

Per the decision above, `context` stays a single flat `Map<String, Object>` with last-write-wins
`putAll` merge on each node completion — **unchanged**. Implications, to be documented for authors:

- Parallel branches share one global context. Two branches writing the **same** key resolve by
  execution order. Under the single-threaded engine this is deterministic for a given definition and
  inputs, but it **is order-dependent** and should not be relied upon as a synchronization mechanism.
- **Guidance:** concurrent branches should write **disjoint** keys (e.g. namespate by branch purpose:
  `impact.severity`, `notify.ticketId`). The AND-join is the correct place to read values produced by
  all branches, since it runs only after every branch has completed and merged its output.
- Branch-scoped context with a defined merge-on-join conflict rule is a **non-goal** here and is the
  natural follow-up if last-write-wins proves insufficient.

## Validation

Both validators — Java `WorkflowValidator` (`engine/.../validation/`) and TypeScript
`validateWorkflow` (`ui/src/validation/validateWorkflow.ts`) — must change in parity. Problems keep
the existing shape (`{ severity, code, message, nodeId?, edgeId? }`).

**Changed:**

- `UNCONDITIONAL_MULTIPLE_EDGES` — **retired as a warning.** The "≥2 unconditional edges" shape is now
  the sanctioned way to author a fork and is valid. Remove the warning (and update the tests and
  `docs/user-guide/validation.md` that reference it). The migration note below covers behavior
  change for existing definitions.

**New (structural discipline for parallelism):**

| Code | Severity | Fires when |
|------|----------|-----------|
| `MIXED_FORK_EDGES` | error | A node's outgoing edges mix unconditional (non-default) edges with conditional and/or default edges — fork vs. exclusive-choice is ambiguous. |
| `FORK_WITHOUT_JOIN` | error | A fork's branches do not re-converge at a single common join before the workflow ends. |
| `UNBALANCED_PARALLEL` | error | The branches of a fork do not all converge at the *same* join (e.g. one branch bypasses it) — structured balance violated. |
| `CROSSING_PARALLEL_REGIONS` | error | An edge enters or leaves a parallel region other than through its fork/join (overlapping/unstructured regions). |
| `PARALLEL_BRANCH_REACHES_END` | error | A parallel branch can reach an `END` node without first passing through its region's join. |
| `PARALLEL_REGION_CYCLE` | error | A cycle exists entirely inside a parallel region (interacts with the existing `AUTOMATED_CYCLE` Tarjan SCC analysis). |

The fork→join pairing / structured-balance analysis is implemented once as a shared helper (per
language) and reused by both the validator and the engine/simulation, so the runtime and the
validator agree on what is a fork, what its join is, and what constitutes a well-formed region.

## UI impact

No new palette entry (per the chosen model). Authoring a fork = drawing ≥2 unconditional edges from a
node; the join is the node where they reconverge.

### `WorkflowViewer` (multi-active highlighting)

`ui/src/components/WorkflowViewer.tsx` currently derives `isCurrent` from
`node.id === instance.currentNodeId`. It must instead test membership in the **set** of active nodes
(`instance.activeBranches.map(b => b.nodeId)`). Multiple nodes can carry `flow-node-current` and the
animated marching-ants ring (`withCurrentRing`, driven by `data.isCurrent`) simultaneously. Edge
highlighting likewise activates all currently-traversed edges. `NodeDetail` / `nodeHistory` become
branch-aware (group visits by `branchId`).

### TS simulation (`ui/src/simulation/simulate.ts`)

`SimState.currentNodeId: string` becomes an **active-branch set** mirroring the engine
(`activeBranches`). `stepSimulation` advances runnable branches; `selectEdge` gains the fork case
(return all edges when the node is a fork); joins hold until all branches arrive; blocking-kind nodes
park per-branch. `SimulationPanel` (`ui/src/components/panels/SimulationPanel.tsx`) shows multiple
active/blocked nodes and a branch-aware path instead of a single "at <node>" line, and the editor's
per-node/per-edge simulation overlay classes (`flow-sim-node-*`, edge `data.simState`) are computed
from the active-branch set.

### `WorkflowEditor` (authoring affordances)

`ui/src/components/WorkflowEditor.tsx` needs no new node type, but should:

- Surface the new validation problems (they flow through the existing built-in + host merge and the
  Problems panel automatically).
- Visually hint that a node forks when it has ≥2 unconditional outgoing edges (e.g. a small "parallel"
  badge or handle affordance), so the reinterpreted-edge semantics are discoverable rather than
  implicit.

## Phased delivery

This spec is Phase 0. Implementation is broken into reviewable phases; each maintains parity within
its scope.

1. **Phase 1 — Java engine + Java validator.** `WorkflowInstance` active-branch state (+ derived
   `currentNodeId`), token-based `advance()`, fork/AND-join/fail-fast/END semantics, `HistoryEntry`
   `branchId`, resume-by-node API, the shared fork→join analysis helper, and the new/changed
   validation rules. Full unit coverage (`WorkflowEngineTest`, `WorkflowValidatorTest`).
2. **Phase 2 — TypeScript parity.** `types/instance.ts` active branches, `simulate.ts` token model,
   `validateWorkflow.ts` new/changed rules + shared analysis helper, and tests
   (`simulate.test.ts`, `validateWorkflow.test.ts`).
3. **Phase 3 — Viewer + simulation UI.** Multi-active highlighting in `WorkflowViewer`, branch-aware
   `NodeDetail`/`nodeHistory`, multi-branch `SimulationPanel`.
4. **Phase 4 — Editor authoring affordances.** Fork visual hint and validation surfacing.
5. **Phase 5 — Documentation + examples.** `docs/user-guide/workflow-model.md`,
   `validation.md`, `engine-usage.md`, `workflow-viewer.md`, `visual-editor.md`, plus a worked
   fork/join example (the CVE analyze-and-notify scenario) and this spec's companion plan in
   `docs/superpowers/plans/`.

## Migration notes

- Definitions with a node that has ≥2 unconditional outgoing edges (previously flagged
  `UNCONDITIONAL_MULTIPLE_EDGES` and executed as "take one") will, after Phase 1, **fork and execute
  all** branches. This is the intended semantic upgrade; the retired warning becomes valid fork
  authoring. Authors who intended exclusive choice must add conditions and/or a default edge.
- The derived `currentNodeId` remains populated for all non-parallel workflows, so existing
  single-path consumers and serialized instances are unaffected until a workflow actually forks.

## Testing (per phase)

Following the project convention (pure, testable logic; JUnit 5 on the engine, vitest on the UI with
no jsdom):

- **Engine:** fork activates all branches; AND-join waits for all and fires once; fail-fast cancels
  siblings; a blocking node parks one branch while others proceed; `END` completes and cancels
  siblings; nested fork/join; status derivation; resume-by-node. `MAX_TRANSITIONS` still bounds the
  token loop.
- **Validators (both):** each new code fires on its minimal offending graph and does not fire on a
  well-formed structured fork/join; the retired `UNCONDITIONAL_MULTIPLE_EDGES` no longer appears.
- **Simulation:** `simulate.ts` step/run over a fork/join graph matches the engine's branch set and
  join behavior; `SimulationPanel` scaffolding driven by multiple active branches.
- Run `npx vitest run` for affected UI tests and `npx tsc --noEmit`; run the engine's Maven test
  suite for Java changes.

## Files affected across future phases (informational — no code in this deliverable)

**Engine (Java):**
- `engine/.../model/WorkflowInstance.java` — active branches + derived `currentNodeId`
- `engine/.../model/HistoryEntry.java` — `branchId`
- `engine/.../engine/WorkflowEngine.java` — token-based `advance()`, fork/join, resume-by-node
- `engine/.../validation/WorkflowValidator.java` — retire/replace edge rules; add structural rules
- `engine/.../validation/` — new shared fork→join analysis helper
- `engine/src/test/.../engine/WorkflowEngineTest.java`, `.../validation/WorkflowValidatorTest.java`

**UI (TypeScript):**
- `ui/src/types/instance.ts` — active branches; `HistoryEntry.branchId`
- `ui/src/simulation/simulate.ts` — token model, fork/join
- `ui/src/validation/validateWorkflow.ts` — new/changed rules + shared analysis helper
- `ui/src/components/WorkflowViewer.tsx`, `ui/src/utils/nodeHistory.ts` — multi-active + branch-aware
- `ui/src/components/panels/SimulationPanel.tsx`, `ui/src/components/WorkflowEditor.tsx` — multi-branch
  simulation + fork authoring hint
- `ui/src/simulation/simulate.test.ts`, `ui/src/validation/validateWorkflow.test.ts`

**Docs:**
- `docs/user-guide/workflow-model.md`, `validation.md`, `engine-usage.md`, `workflow-viewer.md`,
  `visual-editor.md`
- `docs/superpowers/plans/2026-09-04-parallel-execution-fork-join-plan.md` (companion plan)
