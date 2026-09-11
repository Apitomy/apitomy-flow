# Parallel Execution Fork/Join — Phases 4–5 (Editor Affordances + Docs) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended)
> or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`)
> syntax for tracking.

**Goal:** Finish issue #88 by adding the editor's fork/join authoring hint (Phase 4) and the user-guide
documentation + worked fork/join example (Phase 5).

**Architecture:** Phase 4 surfaces static fork/join roles on editor nodes via a pure `parallelRole`
helper (over the existing `analyzeParallelRegions` analyzer), an editor memo that tags node data, and a
`withParallelHint` node HOC that renders a small corner badge — mirroring the existing
`withValidationBadge` decoration pattern. Validation surfacing for the three parallel codes already
works end-to-end (they carry messages and flow through the Problems panel, node badge, and properties
panel), so Phase 4 adds no validation code. Phase 5 extends the existing MkDocs Material user guide with
fork/join sections and a new worked-example page.

**Tech Stack:** TypeScript + React 19, `@xyflow/react` (React Flow v12), Vite, vitest; MkDocs Material
for docs.

**Spec:** `docs/superpowers/specs/2026-09-04-parallel-execution-fork-join-design.md` (Phases 4–5).

## Global Constraints

- All UI commands run from the `ui/` directory. Gates for every code task: `npx tsc --noEmit`,
  `npm run lint`, `npm run build`, and `npx vitest run` (the full suite must stay green — it is 194/194
  at the start of this plan).
- 2-space indentation for TypeScript/TSX/CSS; match each file's existing style.
- No jsdom / React Testing Library. Multi-branch/role derivation goes into pure, framework-free helpers
  unit-tested with vitest; React components are thin renderers verified only by tsc/lint/build + the
  full suite. "No new tests" for a component/CSS task is the mandated convention, not a defect.
- Phase 4 is additive UI work. It may READ `analyzeParallelRegions` from
  `ui/src/simulation/parallelRegions.ts` but must NOT modify `parallelRegions.ts`, `simulate.ts`,
  `validation/*`, or `types/workflow.ts` / `types/instance.ts`. Adding an optional display field to
  `FlowNodeData` in `ui/src/utils/conversion.ts` IS allowed (it is UI display data, not the workflow
  schema).
- Markdown is line-wrapped at 110 characters, except inside tables, code fences, and other structured
  content where wrapping would break rendering.
- Docs are MkDocs Material. Any NEW page must be registered in BOTH the `nav:` block of
  `mkdocs.yml` AND the hand-maintained link list in `docs/index.md`. If `mkdocs` is available on PATH,
  the docs gate is `mkdocs build --strict` from the repo root; otherwise verify every relative link and
  anchor by hand and state that mkdocs was unavailable.
- All Phase 4–5 work lands on branch `issues/gh-88` (PR #97) per the multi-phase-single-PR convention.
- No Claude attribution in commit messages.

---

## File Structure

Phase 4 (all under `ui/src/`):

- `utils/parallelView.ts` — add pure `parallelRole` helper (extends the Phase 3 helper module).
- `utils/parallelView.test.ts` — add `parallelRole` tests.
- `utils/conversion.ts` — add optional `parallelRole` field to `FlowNodeData`.
- `components/WorkflowEditor.tsx` — compute `analyzeParallelRegions` in a memo and tag node data.
- `components/nodes/parallelHint.tsx` — new `withParallelHint` HOC (modeled on `validationBadge.tsx`).
- `components/nodes/parallelHint.css` — badge styling.
- `components/nodes/nodeTypes.ts` — compose `withParallelHint` into the node wrappers.

Phase 5 (all under `docs/`, plus repo-root `mkdocs.yml`):

- `user-guide/workflow-model.md` — add a Parallel Fork/Join section + instance branch fields.
- `user-guide/validation.md` — correct the fork/join rules' placement/severity + rule counts.
- `user-guide/engine-usage.md` — add a Parallel Execution section.
- `user-guide/workflow-viewer.md` — add a Parallel Branches feature subsection.
- `user-guide/visual-editor.md` — document fork authoring, the fork/join hint, and multi-branch sim.
- `user-guide/parallel-fork-join.md` — NEW worked example page (CVE analyze-and-notify).
- `mkdocs.yml` + `docs/index.md` — register the new page in both navs.

---

## Task 1: `parallelRole` pure helper

**Files:**
- Modify: `ui/src/utils/parallelView.ts`
- Test: `ui/src/utils/parallelView.test.ts`

**Interfaces:**
- Consumes: `ParallelAnalysis` (`isFork(nodeId)`, `isJoin(nodeId)`) from
  `../simulation/parallelRegions.ts`.
- Produces: `parallelRole(nodeId: string, analysis: ParallelAnalysis): 'fork' | 'join' | undefined`
  and an exported `type ParallelRole = 'fork' | 'join'`.

- [ ] **Step 1: Write the failing test**

Add to `ui/src/utils/parallelView.test.ts` (match the file's existing import + fixture style). Build a
minimal analysis stub — do NOT construct a real Workflow; a hand-rolled object satisfying the
`ParallelAnalysis` shape is enough:

```typescript
import { parallelRole } from './parallelView.ts';
import { type ParallelAnalysis } from '../simulation/parallelRegions.ts';

function analysisStub(forks: string[], joins: string[]): ParallelAnalysis {
  return {
    isFork: (id) => forks.includes(id),
    isJoin: (id) => joins.includes(id),
    joinFor: () => undefined,
    incomingEdgeIds: () => new Set<string>(),
    problems: [],
  };
}

describe('parallelRole', () => {
  it('returns "fork" for a fork node', () => {
    expect(parallelRole('f', analysisStub(['f'], []))).toBe('fork');
  });
  it('returns "join" for a join node', () => {
    expect(parallelRole('j', analysisStub([], ['j']))).toBe('join');
  });
  it('returns undefined for an ordinary node', () => {
    expect(parallelRole('n', analysisStub(['f'], ['j']))).toBeUndefined();
  });
  it('prefers "fork" if a node is somehow both fork and join', () => {
    expect(parallelRole('x', analysisStub(['x'], ['x']))).toBe('fork');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd ui && npx vitest run src/utils/parallelView.test.ts`
Expected: FAIL — `parallelRole` is not exported.

- [ ] **Step 3: Implement `parallelRole`**

Append to `ui/src/utils/parallelView.ts` (import `ParallelAnalysis` type-only if not already imported):

```typescript
/** A node's static role in a parallel region, if any. */
export type ParallelRole = 'fork' | 'join';

/**
 * Classifies a node's static fork/join role for editor authoring hints.
 *
 * @param nodeId the node to classify
 * @param analysis the static parallel-region analysis of the workflow
 * @returns 'fork' if the node fans out into parallel branches, 'join' if it is the synchronizing
 *          AND-join, or undefined otherwise. Fork takes precedence in the degenerate case where a node
 *          is classified as both.
 */
export function parallelRole(
  nodeId: string,
  analysis: ParallelAnalysis,
): ParallelRole | undefined {
  if (analysis.isFork(nodeId)) {
    return 'fork';
  }
  if (analysis.isJoin(nodeId)) {
    return 'join';
  }
  return undefined;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd ui && npx vitest run src/utils/parallelView.test.ts`
Expected: PASS (4 new cases green).

- [ ] **Step 5: Full gates**

Run: `cd ui && npx tsc --noEmit && npm run lint && npx vitest run && npm run build`
Expected: all clean; full suite green.

- [ ] **Step 6: Commit**

```bash
git add ui/src/utils/parallelView.ts ui/src/utils/parallelView.test.ts
git commit -m "Add parallelRole helper for editor fork/join hints (#88)"
```

---

## Task 2: Tag editor node data with the fork/join role

**Files:**
- Modify: `ui/src/utils/conversion.ts` (add optional field to `FlowNodeData`)
- Modify: `ui/src/components/WorkflowEditor.tsx`

**Interfaces:**
- Consumes: `parallelRole`, `type ParallelRole` from `../utils/parallelView.ts`;
  `analyzeParallelRegions` from `../simulation/parallelRegions.ts`; the existing `currentWorkflow` memo
  and `nodesWithValidation` memo in `WorkflowEditor.tsx`.
- Produces: `FlowNodeData.parallelRole?: ParallelRole`, populated on every editor node.

This task has no vitest step (component wiring). Verified by tsc/lint/build + the full suite.

- [ ] **Step 1: Add the optional display field to `FlowNodeData`**

In `ui/src/utils/conversion.ts`, add an import and a field. `FlowNodeData` currently is
`{ name; nodeType; config; validationProblems? }`:

```typescript
import { type ParallelRole } from './parallelView.ts';
```

Add to the `FlowNodeData` interface:

```typescript
  /** Static fork/join role for the authoring hint, if any (editor only). */
  parallelRole?: ParallelRole;
```

Do not change `toReactFlowNodes` — the base conversion leaves `parallelRole` unset; the editor layers
it on in a memo (Step 3).

- [ ] **Step 2: Compute the parallel analysis in the editor**

In `ui/src/components/WorkflowEditor.tsx`, add the imports (near the existing
`import { validateWorkflow } ...` and the `parallelView` imports):

```typescript
import { analyzeParallelRegions } from '../simulation/parallelRegions.ts';
import { parallelRole } from '../utils/parallelView.ts';
```

Add a memo next to the existing `builtInProblems` memo (which reads `currentWorkflow`):

```typescript
  const parallelAnalysis = useMemo(
    () => analyzeParallelRegions(currentWorkflow),
    [currentWorkflow],
  );
```

- [ ] **Step 3: Populate `parallelRole` in the `nodesWithValidation` memo**

The `nodesWithValidation` memo builds each node's `data` (currently spreads `node.data` and adds
`validationProblems`). Add the role and extend the dependency array to include `parallelAnalysis`:

```typescript
      data: {
        ...node.data,
        validationProblems: problems,
        parallelRole: parallelRole(node.id, parallelAnalysis),
      },
```

Ensure `parallelAnalysis` is added to this memo's dependency array. Do not alter the sim-overlay
`displayNodes` memo — it spreads the already-tagged node data, so `parallelRole` is preserved during
simulation automatically. Confirm this by reading the `displayNodes` memo and verifying it spreads
prior `data` rather than rebuilding it from scratch; if it rebuilds `data`, carry `parallelRole`
through there too.

- [ ] **Step 4: Gates**

Run: `cd ui && npx tsc --noEmit && npm run lint && npx vitest run && npm run build`
Expected: all clean; full suite green (no test count change).

- [ ] **Step 5: Commit**

```bash
git add ui/src/utils/conversion.ts ui/src/components/WorkflowEditor.tsx
git commit -m "Tag editor nodes with their fork/join role (#88)"
```

---

## Task 3: `withParallelHint` node HOC + styling

**Files:**
- Create: `ui/src/components/nodes/parallelHint.tsx`
- Create: `ui/src/components/nodes/parallelHint.css`
- Modify: `ui/src/components/nodes/nodeTypes.ts`

**Interfaces:**
- Consumes: `FlowNodeData.parallelRole` (Task 2); the existing HOC composition in `nodeTypes.ts`
  (`withCurrentRing(withValidationBadge(XNode))`).
- Produces: `withParallelHint(Node)` HOC.

This task has no vitest step (component/CSS). Verified by tsc/lint/build + the full suite. The hint
renders only when `data.parallelRole` is set — the viewer never sets it, so `WorkflowViewer` is
visually unchanged even though it shares `nodeTypes.ts`.

- [ ] **Step 1: Create the HOC**

Read `ui/src/components/nodes/validationBadge.tsx` first and mirror its structure (a wrapper component
that renders the inner node plus an absolutely-positioned corner element). Create
`ui/src/components/nodes/parallelHint.tsx`:

```tsx
import { type ComponentType } from 'react';
import { type NodeProps } from '@xyflow/react';
import { type FlowNodeData } from '../../utils/conversion.ts';
import './parallelHint.css';

const HINT_LABEL: Record<'fork' | 'join', string> = {
  fork: 'Fork',
  join: 'Join',
};

const HINT_TITLE: Record<'fork' | 'join', string> = {
  fork: 'Fork: all outgoing branches run in parallel',
  join: 'Join: waits for all parallel branches to arrive',
};

/**
 * Wraps a node component to render a small corner hint when the node is a parallel fork or join.
 * Renders nothing when {@code data.parallelRole} is unset (e.g. in the read-only viewer).
 *
 * @param Node the node component to wrap
 * @returns the wrapped component
 */
export function withParallelHint(
  Node: ComponentType<NodeProps>,
): ComponentType<NodeProps> {
  return function ParallelHintNode(props: NodeProps) {
    const role = (props.data as FlowNodeData).parallelRole;
    return (
      <div className="flow-parallel-hint-wrap">
        <Node {...props} />
        {role && (
          <span
            className={`flow-parallel-hint flow-parallel-hint-${role}`}
            title={HINT_TITLE[role]}
          >
            {HINT_LABEL[role]}
          </span>
        )}
      </div>
    );
  };
}
```

If `validationBadge.tsx` uses a different prop typing or wrapper element than shown, match ITS
conventions (element tag, class-name approach, how it reads `data`) rather than the sketch above — the
two HOCs should look like siblings.

- [ ] **Step 2: Create the CSS**

Create `ui/src/components/nodes/parallelHint.css`. Match the spacing/positioning idiom used by
`validationBadge` / `currentNodeRing` CSS (read one for the corner-offset convention):

```css
.flow-parallel-hint-wrap {
  position: relative;
}

.flow-parallel-hint {
  position: absolute;
  top: -8px;
  left: -8px;
  padding: 1px 6px;
  border-radius: 8px;
  font-size: 10px;
  font-weight: 600;
  line-height: 1.4;
  color: #fff;
  pointer-events: none;
  z-index: 5;
}

.flow-parallel-hint-fork {
  background: #6c5ce7;
}

.flow-parallel-hint-join {
  background: #00897b;
}
```

- [ ] **Step 2b: Verify the corner does not collide with the validation badge**

`withValidationBadge` renders its icon in a corner too (read it to find which corner — commonly
top-right). Place the parallel hint in a DIFFERENT corner (the sketch uses top-left). If both use the
same corner, adjust one offset so they don't overlap. This is a visual check via the dev app
(`npm run dev`) — note in the report which corners each uses.

- [ ] **Step 3: Compose the HOC in `nodeTypes.ts`**

`nodeTypes.ts` currently wraps each node as `withCurrentRing(withValidationBadge(XNode))`. Add
`withParallelHint` as the innermost wrapper so the hint sits closest to the node and the ring/badge
overlay on top:

```typescript
import { withParallelHint } from './parallelHint.tsx';
// for each node type:
//   withCurrentRing(withValidationBadge(withParallelHint(XNode)))
```

Apply it consistently to every node type already wrapped in the file.

- [ ] **Step 4: Gates**

Run: `cd ui && npx tsc --noEmit && npm run lint && npx vitest run && npm run build`
Expected: all clean; full suite green (no test count change).

- [ ] **Step 5: Commit**

```bash
git add ui/src/components/nodes/parallelHint.tsx ui/src/components/nodes/parallelHint.css ui/src/components/nodes/nodeTypes.ts
git commit -m "Show a fork/join hint badge on editor nodes (#88)"
```

---

## Task 4: Document the model — Parallel Fork/Join + instance branch fields

**Files:**
- Modify: `docs/user-guide/workflow-model.md`

Docs task — no code gates. Verify links/anchors (and `mkdocs build --strict` if available).

- [ ] **Step 1: Add a `### Parallel Fork/Join` subsection under `## Edges`**

Insert immediately after the `### Conditional Routing` subsection (before `### Cycles`). Wrap prose at
110 chars:

````markdown
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
````

- [ ] **Step 2: Document the instance branch fields under `## Workflow Instance`**

The instance field table currently lists `currentNodeId`. Add rows for the branch-model fields (match
the existing table's columns) and a short note. Insert after the `currentNodeId` row / before the
Status Lifecycle subsection:

```markdown
| `activeBranches` | Array | The branches currently executing, each `{ branchId, nodeId }`. A
non-parallel run has a single `root` branch. |
| `joinArrivals` | Object | For each pending join node, the incoming edge ids that have already arrived
and are waiting for the rest. |
```

Then add this note (wrapped at 110):

```markdown
When multiple branches are active, `currentNodeId` is `null` (it is a convenience for the
single-branch case). Each `HistoryEntry` carries an optional `branchId` tagging which branch made the
visit; a missing `branchId` denotes the `root` branch.
```

- [ ] **Step 3: Verify + commit**

Verify the two new relative links resolve (`validation.md#parallel-structure-error` — the anchor is
created in Task 5; `parallel-fork-join.md` — the page is created in Task 9). Cross-task anchors are
expected; note them in the report. Run `mkdocs build --strict` if available.

```bash
git add docs/user-guide/workflow-model.md
git commit -m "Document parallel fork/join in the workflow model guide (#88)"
```

---

## Task 5: Correct the fork/join validation rules reference

**Files:**
- Modify: `docs/user-guide/validation.md`

Docs task — no code gates.

- [ ] **Step 1: Move the parallel rules out of "Semantic (WARNING)" into their own ERROR section**

The three parallel codes are currently table rows under `### Semantic (WARNING)`, but the validator
emits them at **ERROR** severity (`ui/src/validation/validateWorkflow.ts`). Remove those three rows
from the Semantic table and add a new subsection after `### Semantic (WARNING)`:

```markdown
### Parallel Structure (ERROR)

| Code | Description |
| --- | --- |
| `MIXED_FORK_EDGES` | Node mixes unconditional (fork) edges with conditional/default edges; make all
outgoing edges unconditional to fork, or add conditions/a default for exclusive choice |
| `FORK_WITHOUT_JOIN` | Parallel branches from a fork do not re-converge at a single join |
| `PARALLEL_BRANCH_REACHES_END` | A parallel branch can reach an end node without first joining |
```

The `### Parallel Structure (ERROR)` heading yields the anchor
`#parallel-structure-error` referenced from `workflow-model.md`.

- [ ] **Step 2: Reconcile the rule counts in `## Rule Coverage`**

The Rule Coverage paragraph states fixed totals ("all **55** rules", and a TypeScript count). Phase 1
retired `UNCONDITIONAL_MULTIPLE_EDGES` and added the three parallel codes (net change relative to the
pre-fork/join counts). Verify the true counts by counting the distinct codes actually emitted:

Run from repo root:
```bash
grep -oE "'[A-Z_]+'" ui/src/validation/validateWorkflow.ts | sort -u | wc -l
```
Cross-check the Java validator similarly if the doc cites a separate Java total. Update the numbers in
`## Rule Coverage` to the verified counts, and confirm `UNCONDITIONAL_MULTIPLE_EDGES` no longer appears
anywhere in `validation.md`. Report the before/after numbers.

- [ ] **Step 3: Verify + commit**

Confirm the `### Edge / Condition (WARNING)` section does not still list `UNCONDITIONAL_MULTIPLE_EDGES`.
Run `mkdocs build --strict` if available.

```bash
git add docs/user-guide/validation.md
git commit -m "Correct fork/join validation rules and counts in the docs (#88)"
```

---

## Task 6: Document parallel execution in the engine guide

**Files:**
- Modify: `docs/user-guide/engine-usage.md`

Docs task — no code gates.

- [ ] **Step 1: Add a `## Parallel Execution` section**

Insert before the `## Immutability` section (after `## Action Chaining`). Wrap at 110:

````markdown
## Parallel Execution

When execution reaches a fork (a node whose outgoing edges are all unconditional), the engine activates
every branch. `advance` progresses all runnable branches; the instance stays `RUNNING` while any branch
can still make progress and `WAITING` when every remaining branch is parked on a human task, received
event, or wait node.

```java
WorkflowInstance instance = engine.startWorkflow(workflow, context);
// After a fork, more than one branch may be active at once.
List<ActiveBranch> active = instance.activeBranches();
```

Key semantics:

- **AND-join (wait-for-all).** A join node fires once, only after every parallel branch has arrived.
  Arrivals accumulate in `joinArrivals` until the last one lands.
- **Fail-fast.** If any branch fails and is not recovered by an error handler, the whole instance
  transitions to `FAILED`; sibling branches stop.
- **END cancels siblings.** An `end` node reached on any branch terminates the entire instance.
- **`currentNodeId` is `null`** whenever zero or more than one branch is active. Use `activeBranches`
  to inspect concurrent progress.

Resume a specific parked branch by node id — sibling branches keep waiting:

```java
// Complete one waiting human-task/event/wait branch, addressed by node id:
WorkflowInstance next = engine.completeNode(workflow, instance, "notify-team", result);
```

`completeCurrentNode` remains available and delegates to `completeNode` for the single-branch case.
The branch-addressable info accessors (`getHumanTaskInfo`, `getReceiveEventInfo`, `getWaitInfo`,
`matchesEvent`) take a `nodeId` so concurrent waiting branches can be inspected independently.
````

If the exact method names/return types above differ from the current Java API, correct them against
`engine/src/main/java/.../WorkflowEngine.java` before committing — the code blocks must compile against
the real API. Report any signature you adjusted.

- [ ] **Step 2: Verify + commit**

```bash
git add docs/user-guide/engine-usage.md
git commit -m "Document parallel execution in the engine usage guide (#88)"
```

---

## Task 7: Document parallel branches in the viewer guide

**Files:**
- Modify: `docs/user-guide/workflow-viewer.md`

Docs task — no code gates.

- [ ] **Step 1: Add a `### Parallel Branches` feature subsection**

Insert under `## Features`, after the `### Current Node Highlight` / `### Path Taken` subsections. Wrap
at 110:

```markdown
### Parallel Branches

For instances that fork, the viewer highlights **every** currently-active node at once rather than a
single cursor. The arrival edge of each active branch is animated, while all previously-traversed edges
keep their static "taken" styling. When you open a node's detail, its visit history is grouped by
branch, and a **Branch** row identifies which branch a given visit belongs to (the `root` branch is not
labeled). At a terminal state — completed, failed, or cancelled — no branches are active, so the viewer
falls back to highlighting the final node.
```

- [ ] **Step 2: Verify + commit**

```bash
git add docs/user-guide/workflow-viewer.md
git commit -m "Document parallel-branch visualization in the viewer guide (#88)"
```

---

## Task 8: Document fork authoring + hint + multi-branch sim in the editor guide

**Files:**
- Modify: `docs/user-guide/visual-editor.md`

Docs task — no code gates.

- [ ] **Step 1: Document the fork/join hint under `### Custom Nodes` (or add a `### Fork/Join Hint`)**

Add a subsection under `## Features` (place it after `### Live Validation`). Wrap at 110:

```markdown
### Fork/Join Hint

The editor tags nodes with a small corner badge showing their role in a parallel region: **Fork** on a
node whose outgoing edges all run in parallel, and **Join** on the node where those branches
re-converge. The hint is derived live from the graph shape as you draw edges, so it appears as soon as
a node gains two or more unconditional outgoing edges and disappears if you add a condition or default
that turns the branch into an exclusive choice.

To author a fork, draw two or more edges out of a node and leave them all unconditional (no condition,
no default). To make the same node an exclusive choice instead, give the edges conditions and mark one
as the default. The editor validates parallel structure live and flags `MIXED_FORK_EDGES`,
`FORK_WITHOUT_JOIN`, and `PARALLEL_BRANCH_REACHES_END` in the Problems panel and on the node.
```

- [ ] **Step 2: Extend `### Simulation and Condition Testing` for multi-branch simulation**

Append a paragraph to the existing simulation subsection. Wrap at 110:

```markdown
Simulation supports parallel workflows. After a fork, the panel lists every active node and animates
each active branch on the canvas. When more than one branch is blocked on input, a picker lets you
choose which blocked node to resume: fill in its mock output, deliver it, and repeat for the next
blocked branch. The execution path is shown grouped per branch.
```

- [ ] **Step 3: Verify + commit**

```bash
git add docs/user-guide/visual-editor.md
git commit -m "Document fork authoring, hint, and multi-branch simulation in the editor guide (#88)"
```

---

## Task 9: Worked example page — CVE analyze-and-notify fork/join

**Files:**
- Create: `docs/user-guide/parallel-fork-join.md`
- Modify: `mkdocs.yml` (nav)
- Modify: `docs/index.md` (link list)

Docs task — no code gates, but the example workflow JSON MUST be a valid `Workflow` (verify field
shapes against `ui/src/types/workflow.ts`).

- [ ] **Step 1: Create the worked-example page**

Create `docs/user-guide/parallel-fork-join.md`. The complete workflow below is valid: `fetch-cve` has
two unconditional outgoing edges (a fork), both branches converge on `create-report` (the AND-join),
and no branch reaches `end` before joining. Wrap prose at 110; leave the JSON fence unwrapped.

````markdown
# Parallel Fork/Join Example

This worked example triages a CVE by running two independent steps in parallel — assessing impact and
notifying the security team — then joining to produce a single report. It exercises a fork, an
AND-join, and branch-aware simulation.

## The workflow

`fetch-cve` fans out to `analyze-impact` and `notify-team` (both edges are unconditional, so they run
in parallel). Both branches converge on `create-report`, which waits for both before it runs.

```json
{
  "id": "cve-analyze-and-notify",
  "name": "CVE Analyze and Notify",
  "description": "Assess impact and notify the security team in parallel, then report.",
  "version": 1,
  "nodes": [
    {
      "id": "start", "type": "start", "name": "Start",
      "config": { "inputs": [{ "name": "cveId", "type": "string", "required": true }] },
      "position": { "x": 40, "y": 200 }
    },
    {
      "id": "fetch-cve", "type": "action", "name": "Fetch CVE Details",
      "config": {
        "actionType": "fetch-cve",
        "inputs": { "CVE ID": "context.cveId" },
        "outputs": [{ "name": "cve", "type": "object", "required": true }]
      },
      "position": { "x": 260, "y": 200 }
    },
    {
      "id": "analyze-impact", "type": "action", "name": "Analyze Impact",
      "config": {
        "actionType": "analyze-impact",
        "inputs": { "CVE": "context.cve" },
        "outputs": [{ "name": "severity", "type": "string", "required": true }]
      },
      "position": { "x": 500, "y": 100 }
    },
    {
      "id": "notify-team", "type": "action", "name": "Notify Security Team",
      "config": {
        "actionType": "send-notification",
        "inputs": { "CVE ID": "context.cveId" },
        "outputs": [{ "name": "notifiedAt", "type": "string", "required": true }]
      },
      "position": { "x": 500, "y": 300 }
    },
    {
      "id": "create-report", "type": "action", "name": "Create Report",
      "config": {
        "actionType": "create-report",
        "inputs": { "CVE ID": "context.cveId", "Severity": "context.severity" },
        "outputs": [{ "name": "reportUrl", "type": "string", "required": true }]
      },
      "position": { "x": 760, "y": 200 }
    },
    {
      "id": "end", "type": "end", "name": "Published",
      "config": { "outcome": "published" },
      "position": { "x": 1000, "y": 200 }
    }
  ],
  "edges": [
    { "id": "e1", "source": "start", "target": "fetch-cve", "priority": 0, "isDefault": false },
    { "id": "e2", "source": "fetch-cve", "target": "analyze-impact", "priority": 0, "isDefault": false },
    { "id": "e3", "source": "fetch-cve", "target": "notify-team", "priority": 1, "isDefault": false },
    { "id": "e4", "source": "analyze-impact", "target": "create-report", "priority": 0, "isDefault": false },
    { "id": "e5", "source": "notify-team", "target": "create-report", "priority": 0, "isDefault": false },
    { "id": "e6", "source": "create-report", "target": "end", "priority": 0, "isDefault": false }
  ]
}
```

## Why this is a valid fork/join

- **`fetch-cve` is a fork:** it has two outgoing edges (`e2`, `e3`), both unconditional
  (`isDefault: false`, no `condition`). Entering `fetch-cve` activates both branches.
- **`create-report` is the join:** it is the first node reachable from both branches and has two
  incoming edges (`e4`, `e5`). As an AND-join it runs only after both `analyze-impact` and `notify-team`
  complete.
- **The region is balanced:** neither branch reaches `end` before `create-report`, so it validates with
  no `FORK_WITHOUT_JOIN` or `PARALLEL_BRANCH_REACHES_END` problems.

## Running it

Starting the workflow activates both branches after `fetch-cve`. The instance's `activeBranches` holds
one entry per running branch; `currentNodeId` is `null` while both run. `create-report` fires once both
arrive; its two incoming edge ids accumulate in `joinArrivals` until the second lands. See
[Engine Usage](engine-usage.md#parallel-execution) for the resume-by-node API.

## Visualizing and simulating it

The [Workflow Viewer](workflow-viewer.md#parallel-branches) highlights both active nodes at once and
animates both branch arrivals. In the [Visual Editor](visual-editor.md#forkjoin-hint), `fetch-cve`
carries a **Fork** badge and `create-report` a **Join** badge, and simulation lets you resume each
blocked branch one at a time.
````

- [ ] **Step 2: Register the page in the MkDocs nav**

In `mkdocs.yml`, add the page to the `nav:` block under the User Guide section, adjacent to the other
user-guide entries (match the existing indentation and title style):

```yaml
      - Parallel Fork/Join: user-guide/parallel-fork-join.md
```

- [ ] **Step 3: Register the page in the `docs/index.md` link list**

In `docs/index.md`, add a matching entry to the hand-maintained user-guide link list (match the
surrounding markdown-list style):

```markdown
- [Parallel Fork/Join](user-guide/parallel-fork-join.md) — a worked fork/join workflow
```

- [ ] **Step 4: Verify + commit**

Run `mkdocs build --strict` if available (it will catch a missing nav entry or broken link); otherwise
verify every relative link in the new page and the two nav edits by hand. Confirm the anchors
referenced here exist: `engine-usage.md#parallel-execution` (Task 6),
`workflow-viewer.md#parallel-branches` (Task 7), `visual-editor.md#forkjoin-hint` (Task 8).

```bash
git add docs/user-guide/parallel-fork-join.md mkdocs.yml docs/index.md
git commit -m "Add a worked fork/join example page to the docs (#88)"
```

---

## Self-Review

**Spec coverage:**
- Phase 4 "Fork visual hint" → Tasks 1–3 (`parallelRole` helper, editor tagging, `withParallelHint`
  HOC). ✅
- Phase 4 "validation surfacing" → already satisfied by Phases 1–2 (the three parallel codes carry
  messages and render in the Problems panel, node badge, and properties panel). No code task; Task 5
  corrects the *docs* to match the real ERROR severity. ✅
- Phase 5 docs (`workflow-model.md`, `validation.md`, `engine-usage.md`, `workflow-viewer.md`,
  `visual-editor.md`) → Tasks 4–8. ✅
- Phase 5 worked fork/join example (CVE analyze-and-notify) → Task 9. ✅
- Phase 5 "this spec's companion plan in `docs/superpowers/plans/`" → this document. ✅

**Placeholder scan:** No TBD/TODO. Every code step has complete code; every doc step has the actual
markdown to add. Two guarded verification points (engine API signatures in Task 6, rule counts in Task
5) instruct the implementer to confirm against source and report — these are verification steps, not
placeholders. ✅

**Type consistency:**
- `parallelRole(nodeId, analysis): 'fork' | 'join' | undefined` and `type ParallelRole` — defined Task
  1, imported in `conversion.ts` (Task 2) and consumed in `WorkflowEditor.tsx` (Task 2) and
  `parallelHint.tsx` (Task 3). ✅
- `FlowNodeData.parallelRole?: ParallelRole` — defined Task 2, read Task 3. ✅
- `ParallelAnalysis` (isFork/isJoin) — consumed read-only from `parallelRegions.ts`; not modified. ✅

**Cross-task anchors (intentional):** `workflow-model.md` (Task 4) links to
`validation.md#parallel-structure-error` (Task 5) and `parallel-fork-join.md` (Task 9); the worked
example (Task 9) links to anchors created in Tasks 6–8. When executing sequentially these resolve by
the end; a `mkdocs build --strict` gate should run only after Task 9 (or note unresolved forward links
in intermediate tasks). ✅
