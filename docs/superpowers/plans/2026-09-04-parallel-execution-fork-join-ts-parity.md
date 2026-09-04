# Parallel Execution Fork/Join — Phase 2: TypeScript Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring the TypeScript library (`ui/`) to parity with the Phase 1 Java engine's fork/join
parallelism: an active-branch token model in the simulation, a shared fork→join structural analyzer,
and the new/changed validation rules — all with vitest coverage mirroring the engine tests.

**Architecture:** Port the Java `ParallelRegions` static analyzer to a pure TS module reused by both
the simulator and the validator (mirroring the engine→validator dependency). Convert
`simulate.ts` from a single `currentNodeId` cursor to a set of active-branch tokens that fan out at
forks and synchronize (wait-for-all) at joins, keeping `currentNodeId`/`blockedOn` as derived
back-compat fields so the existing (Phase 3-owned) UI keeps compiling. Retire the
`UNCONDITIONAL_MULTIPLE_EDGES` warning and surface the new structural codes through the validator.

**Tech Stack:** TypeScript + React 19, `@xyflow/react`, Vite, vitest (no jsdom — pure testable
logic). All commands run from `ui/`.

**Spec:** `docs/superpowers/specs/2026-09-04-parallel-execution-fork-join-design.md` (Phase 2 is
defined in its "Phased delivery" §2). The Phase 1 Java implementation this ports from lives on branch
`issues/gh-88` (PR #97): `engine/src/main/java/io/apitomy/flow/engine/ParallelRegions.java`,
`WorkflowEngine.java`, and `engine/.../validation/WorkflowValidator.java`.

## Global Constraints

- **Parity target:** behavior must match the Phase 1 Java engine. Fork = a node with ≥2 outgoing
  edges where **every** edge is unconditional (no `condition`) **and** non-default (`isDefault ===
  false`). AND-join = the earliest node reachable from **all** fork branches; it fires **once** all
  incoming edges have received a branch token. Fail-fast: any branch failure fails the whole run.
  `END` completes the whole run and cancels siblings.
- **Branch id scheme (verbatim from engine):** root branch id is `"root"`; fork children are
  `"<parentBranchId>.<index>"` (0-based); the continuing branch after a join fires is
  `"<joinNodeId>#join"`.
- **Structural codes (exact strings):** `MIXED_FORK_EDGES`, `FORK_WITHOUT_JOIN`,
  `PARALLEL_BRANCH_REACHES_END` are the three the analyzer emits. (`UNBALANCED_PARALLEL`,
  `CROSSING_PARALLEL_REGIONS`, `PARALLEL_REGION_CYCLE` are defined in the spec but **not emitted** in
  Phase 1 — do not emit them here either; parity with the engine is the rule.)
- **Retire** `UNCONDITIONAL_MULTIPLE_EDGES` entirely (validator + docs). That edge shape is now valid
  fork authoring.
- **Code style:** 4-space indentation in `simulate.ts` (match the existing file); 2-space in
  `validateWorkflow.ts`/`instance.ts` (match those files). Explicit types; keep the files React-free
  and pure. Do not introduce `@testing-library`/jsdom.
- **Verify every task:** run `npx vitest run <changed test file>` and `npx tsc --noEmit` before
  marking a task complete. The final task also runs `npm run lint` and `npm run build`. Do not report
  work done on unverified code.
- **No Claude attribution** in commit messages.

---

### Task 1: Instance types — active branches, join arrivals, branch-attributed history

**Files:**
- Modify: `ui/src/types/instance.ts`
- Modify: `ui/src/index.ts` (export the new `ActiveBranch` type)
- Modify: `ui/src/dev/sampleWorkflows.ts:96,116,145` (three `WorkflowInstance` literals gain the new
  required fields)

**Interfaces:**
- Produces: `interface ActiveBranch { branchId: string; nodeId: string }`;
  `WorkflowInstance.activeBranches: ActiveBranch[]`;
  `WorkflowInstance.joinArrivals: Record<string, string[]>`;
  `WorkflowInstance.currentNodeId: string | null` (was `string`);
  `HistoryEntry.branchId?: string`. Tasks 2–5 consume `ActiveBranch`.

- [ ] **Step 1: Rewrite `ui/src/types/instance.ts`**

```typescript
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
```

- [ ] **Step 2: Export `ActiveBranch` from the library entry point**

In `ui/src/index.ts`, extend the existing instance re-export:

```typescript
export type { WorkflowInstance, InstanceStatus, HistoryEntry, ActiveBranch } from './types/instance.ts';
```

- [ ] **Step 3: Update the three dev `WorkflowInstance` fixtures**

In `ui/src/dev/sampleWorkflows.ts`, each of the three instance literals (at lines ~96, ~116, ~145)
already sets `currentNodeId: '<id>'`. Immediately after each `currentNodeId:` line, add the two new
required fields, deriving the single active branch from that same node id. For the fixture whose
`currentNodeId` is `'triage'`:

```typescript
  currentNodeId: 'triage',
  activeBranches: [{ branchId: 'root', nodeId: 'triage' }],
  joinArrivals: {},
```

For the `'end-mitigated'` fixture:

```typescript
  currentNodeId: 'end-mitigated',
  activeBranches: [{ branchId: 'root', nodeId: 'end-mitigated' }],
  joinArrivals: {},
```

Apply the same pattern (matching `activeBranches[0].nodeId` to that literal's `currentNodeId`) to all
three.

- [ ] **Step 4: Typecheck**

Run: `cd ui && npx tsc --noEmit`
Expected: PASS (no errors). If a `WorkflowInstance` construction elsewhere now lacks
`activeBranches`/`joinArrivals`, add them the same way (single `"root"` branch at the existing
`currentNodeId`, empty `joinArrivals`).

- [ ] **Step 5: Run the existing suite to confirm no regressions**

Run: `cd ui && npx vitest run`
Expected: PASS (this task changes only types + fixtures).

- [ ] **Step 6: Commit**

```bash
git add ui/src/types/instance.ts ui/src/index.ts ui/src/dev/sampleWorkflows.ts
git commit -m "feat(types): active-branch instance state and branch-attributed history (#88)"
```

---

### Task 2: Shared fork→join analyzer (port of `ParallelRegions.java`)

**Files:**
- Create: `ui/src/simulation/parallelRegions.ts`
- Test: `ui/src/simulation/parallelRegions.test.ts`

**Placement rationale:** the analyzer lives under `simulation/` (the runtime-parity module) and is
imported by both the simulator and the validator, mirroring the Java arrangement where the validator
imports `io.apitomy.flow.engine.ParallelRegions`.

**Interfaces:**
- Produces:
  ```typescript
  interface ParallelProblem { code: string; nodeId: string }
  interface ParallelAnalysis {
    isFork(nodeId: string): boolean;
    isJoin(nodeId: string): boolean;
    joinFor(forkNodeId: string): string | undefined;
    incomingEdgeIds(joinNodeId: string): Set<string>;
    problems: ParallelProblem[];
  }
  function analyzeParallelRegions(workflow: Workflow): ParallelAnalysis;
  ```
  Consumed by Task 3 (validator) and Task 5 (simulator).

- [ ] **Step 1: Write the failing tests**

Create `ui/src/simulation/parallelRegions.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { type Workflow, type WorkflowNode, type WorkflowEdge } from '../types/workflow.ts';
import { analyzeParallelRegions } from './parallelRegions.ts';

function node(id: string, type: WorkflowNode['type']): WorkflowNode {
    return { id, type, name: id, config: {}, position: { x: 0, y: 0 } };
}
function edge(id: string, source: string, target: string, extra: Partial<WorkflowEdge> = {}): WorkflowEdge {
    return { id, source, target, priority: 0, isDefault: false, ...extra };
}
function workflow(nodes: WorkflowNode[], edges: WorkflowEdge[]): Workflow {
    return { id: 'wf', name: 'wf', nodes, edges };
}

/** start -> f(fork) -> a, b ; a -> j, b -> j ; j -> end */
function forkJoin(): Workflow {
    return workflow(
        [node('start', 'start'), node('f', 'wait'), node('a', 'action'), node('b', 'action'),
            node('j', 'wait'), node('end', 'end')],
        [edge('s', 'start', 'f'), edge('fa', 'f', 'a'), edge('fb', 'f', 'b'),
            edge('aj', 'a', 'j'), edge('bj', 'b', 'j'), edge('je', 'j', 'end')],
    );
}

describe('analyzeParallelRegions', () => {
    it('classifies a fork and its matching join', () => {
        const r = analyzeParallelRegions(forkJoin());
        expect(r.isFork('f')).toBe(true);
        expect(r.isJoin('j')).toBe(true);
        expect(r.joinFor('f')).toBe('j');
        expect(r.problems).toEqual([]);
    });

    it('reports every incoming edge of the join', () => {
        const r = analyzeParallelRegions(forkJoin());
        expect(r.incomingEdgeIds('j')).toEqual(new Set(['aj', 'bj']));
    });

    it('returns a fresh incoming-edge set each call (no shared mutable state)', () => {
        const r = analyzeParallelRegions(forkJoin());
        const first = r.incomingEdgeIds('j');
        first.add('mutated');
        expect(r.incomingEdgeIds('j')).toEqual(new Set(['aj', 'bj']));
    });

    it('does not treat an exclusive choice as a fork', () => {
        const w = workflow(
            [node('start', 'start'), node('a', 'end'), node('b', 'end')],
            [edge('ea', 'start', 'a', { condition: 'context.x == 1' }),
                edge('eb', 'start', 'b', { isDefault: true })],
        );
        const r = analyzeParallelRegions(w);
        expect(r.isFork('start')).toBe(false);
        expect(r.problems).toEqual([]);
    });

    it('reports MIXED_FORK_EDGES when unconditional and conditional edges are mixed', () => {
        const w = workflow(
            [node('start', 'start'), node('a', 'end'), node('b', 'end')],
            [edge('ea', 'start', 'a'), edge('eb', 'start', 'b', { condition: 'context.x == 1' })],
        );
        const r = analyzeParallelRegions(w);
        expect(r.isFork('start')).toBe(false);
        expect(r.problems).toContainEqual({ code: 'MIXED_FORK_EDGES', nodeId: 'start' });
    });

    it('reports FORK_WITHOUT_JOIN when branches never re-converge', () => {
        const w = workflow(
            [node('start', 'start'), node('a', 'action'), node('b', 'action'),
                node('ea', 'end'), node('eb', 'end')],
            [edge('fa', 'start', 'a'), edge('fb', 'start', 'b'),
                edge('ae', 'a', 'ea'), edge('be', 'b', 'eb')],
        );
        const r = analyzeParallelRegions(w);
        // both branches reach an END without a common convergence node
        expect(r.problems.some(p => p.nodeId === 'start'
            && (p.code === 'FORK_WITHOUT_JOIN' || p.code === 'PARALLEL_BRANCH_REACHES_END'))).toBe(true);
    });

    it('reports PARALLEL_BRANCH_REACHES_END when a branch can hit END before the join', () => {
        // start forks to a and b; a -> j, b -> end (bypasses the join), j has a and (would-be) b
        const w = workflow(
            [node('start', 'start'), node('a', 'action'), node('b', 'action'),
                node('j', 'wait'), node('end', 'end')],
            [edge('fa', 'start', 'a'), edge('fb', 'start', 'b'),
                edge('aj', 'a', 'j'), edge('be', 'b', 'end'), edge('je', 'j', 'end')],
        );
        const r = analyzeParallelRegions(w);
        expect(r.problems.some(p => p.nodeId === 'start' && p.code === 'PARALLEL_BRANCH_REACHES_END'))
            .toBe(true);
    });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd ui && npx vitest run src/simulation/parallelRegions.test.ts`
Expected: FAIL — `analyzeParallelRegions` is not defined (module missing).

- [ ] **Step 3: Implement the analyzer**

Create `ui/src/simulation/parallelRegions.ts` (4-space indentation):

```typescript
import { type Workflow, type WorkflowEdge } from '../types/workflow.ts';

/** A structural problem discovered during parallel-region analysis. */
export interface ParallelProblem {
    code: string;
    nodeId: string;
}

/**
 * Result of static parallel-region analysis: fork/join classification plus any structural problems.
 * Mirrors the Java {@code io.apitomy.flow.engine.ParallelRegions} so the validator and the simulation
 * agree on what a fork is, what its join is, and what a well-formed region looks like. Pure and
 * side-effect free.
 */
export interface ParallelAnalysis {
    /** @returns true if the node is a fork (≥2 outgoing edges, all unconditional and non-default). */
    isFork(nodeId: string): boolean;
    /** @returns true if the node is the synchronizing join of some fork. */
    isJoin(nodeId: string): boolean;
    /** @returns the join node id paired with the given fork, or undefined if none. */
    joinFor(forkNodeId: string): string | undefined;
    /** @returns a fresh copy of the incoming edge ids a join must collect before it fires. */
    incomingEdgeIds(joinNodeId: string): Set<string>;
    /** The structural problems discovered during analysis. */
    problems: ParallelProblem[];
}

function isUnconditional(e: WorkflowEdge): boolean {
    return !e.condition || e.condition.trim() === '';
}

function outgoing(workflow: Workflow, nodeId: string): WorkflowEdge[] {
    return workflow.edges.filter(e => e.source === nodeId);
}

function isEndNode(workflow: Workflow, nodeId: string): boolean {
    return workflow.nodes.find(n => n.id === nodeId)?.type === 'end';
}

/**
 * Analyzes a workflow's parallel structure.
 *
 * @param workflow the workflow to analyze
 * @returns the computed regions and any structural problems
 */
export function analyzeParallelRegions(workflow: Workflow): ParallelAnalysis {
    const forks = new Set<string>();
    const joins = new Set<string>();
    const forkToJoin = new Map<string, string>();
    const joinIncoming = new Map<string, Set<string>>();
    const problems: ParallelProblem[] = [];

    for (const node of workflow.nodes) {
        const out = outgoing(workflow, node.id);
        if (out.length < 2) {
            continue;
        }
        const anyForkShaped = out.some(e => isUnconditional(e) && !e.isDefault);
        const allForkShaped = out.every(e => isUnconditional(e) && !e.isDefault);
        if (allForkShaped) {
            forks.add(node.id);
        } else if (anyForkShaped) {
            problems.push({ code: 'MIXED_FORK_EDGES', nodeId: node.id });
        }
    }

    for (const forkId of forks) {
        const join = findJoin(workflow, forkId, problems);
        if (join !== null) {
            forkToJoin.set(forkId, join);
            joins.add(join);
            const incoming = new Set<string>();
            for (const e of workflow.edges) {
                if (e.target === join) {
                    incoming.add(e.id);
                }
            }
            joinIncoming.set(join, incoming);
        }
    }

    return {
        isFork: (nodeId) => forks.has(nodeId),
        isJoin: (nodeId) => joins.has(nodeId),
        joinFor: (forkNodeId) => forkToJoin.get(forkNodeId),
        incomingEdgeIds: (joinNodeId) => new Set(joinIncoming.get(joinNodeId) ?? []),
        problems,
    };
}

/**
 * Finds the synchronizing join for a fork: the earliest node where every branch leaving the fork
 * re-converges. Records FORK_WITHOUT_JOIN / PARALLEL_BRANCH_REACHES_END when no single balanced
 * convergence node exists. Mirrors {@code ParallelRegions.findJoin}.
 */
function findJoin(workflow: Workflow, forkId: string, problems: ParallelProblem[]): string | null {
    const branches = outgoing(workflow, forkId);
    const reachablePerBranch: Set<string>[] = [];
    let anyBranchReachesEnd = false;

    for (const branch of branches) {
        const reachable = new Set<string>();
        const queue: string[] = [branch.target];
        while (queue.length > 0) {
            const current = queue.shift() as string;
            if (reachable.has(current)) {
                continue;
            }
            reachable.add(current);
            if (isEndNode(workflow, current)) {
                anyBranchReachesEnd = true;
            }
            for (const out of outgoing(workflow, current)) {
                queue.push(out.target);
            }
        }
        reachablePerBranch.push(reachable);
    }

    // Common = nodes reachable from ALL branches.
    let common = new Set<string>(reachablePerBranch[0]);
    for (let i = 1; i < reachablePerBranch.length; i++) {
        common = new Set([...common].filter(n => reachablePerBranch[i].has(n)));
    }
    if (common.size === 0) {
        problems.push({
            code: anyBranchReachesEnd ? 'PARALLEL_BRANCH_REACHES_END' : 'FORK_WITHOUT_JOIN',
            nodeId: forkId,
        });
        return null;
    }

    // Earliest common node, using branch[0]'s BFS insertion order as the canonical ordering.
    let join: string | null = null;
    for (const candidate of reachablePerBranch[0]) {
        if (common.has(candidate)) {
            join = candidate;
            break;
        }
    }
    if (join === null) {
        join = common.values().next().value as string;
    }

    // Balance: every branch must reach the join without first hitting END.
    for (const branch of branches) {
        if (reachesEndBeforeJoin(workflow, branch.target, join)) {
            problems.push({ code: 'PARALLEL_BRANCH_REACHES_END', nodeId: forkId });
            return null;
        }
    }
    return join;
}

function reachesEndBeforeJoin(workflow: Workflow, start: string, join: string): boolean {
    const visited = new Set<string>();
    const queue: string[] = [start];
    while (queue.length > 0) {
        const current = queue.shift() as string;
        if (current === join || visited.has(current)) {
            continue;
        }
        visited.add(current);
        if (isEndNode(workflow, current)) {
            return true;
        }
        for (const out of outgoing(workflow, current)) {
            queue.push(out.target);
        }
    }
    return false;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd ui && npx vitest run src/simulation/parallelRegions.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Typecheck**

Run: `cd ui && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add ui/src/simulation/parallelRegions.ts ui/src/simulation/parallelRegions.test.ts
git commit -m "feat(sim): shared fork/join structural analyzer (#88)"
```

---

### Task 3: Validator — retire `UNCONDITIONAL_MULTIPLE_EDGES`, add structural parallel rules

**Files:**
- Modify: `ui/src/validation/validateWorkflow.ts` (remove the `UNCONDITIONAL_MULTIPLE_EDGES` block at
  ~lines 248–251; add a `validateParallelStructure` pass wired into `validateWorkflow`)
- Modify: `ui/src/validation/validateWorkflow.test.ts` (add parity tests)
- Modify: `docs/user-guide/validation.md` (remove the retired row; add the new codes)
- Test: `ui/src/validation/validateWorkflow.test.ts`

**Interfaces:**
- Consumes: `analyzeParallelRegions` and `ParallelProblem` from `../simulation/parallelRegions.ts`
  (Task 2).
- Produces: `validateWorkflow` now emits `MIXED_FORK_EDGES`, `FORK_WITHOUT_JOIN`,
  `PARALLEL_BRANCH_REACHES_END` (all `severity: 'error'`) and no longer emits
  `UNCONDITIONAL_MULTIPLE_EDGES`.

- [ ] **Step 1: Write the failing tests**

Append to `ui/src/validation/validateWorkflow.test.ts` (uses the file's existing `node`/`edge`/
`workflow`/`hasProblem` helpers):

```typescript
describe('parallel structure', () => {
  // start -> f(fork) -> a, b ; a -> j, b -> j ; j -> end
  function wellFormedForkJoin(): Workflow {
    return workflow(
      [node('start', 'start'), node('f', 'wait'), node('a', 'action'), node('b', 'action'),
        node('j', 'wait'), node('end', 'end')],
      [edge('s', 'start', 'f'), edge('fa', 'f', 'a'), edge('fb', 'f', 'b'),
        edge('aj', 'a', 'j'), edge('bj', 'b', 'j'), edge('je', 'j', 'end')],
    );
  }

  it('no longer emits the retired UNCONDITIONAL_MULTIPLE_EDGES warning', () => {
    expect(hasProblem(validateWorkflow(wellFormedForkJoin()), 'UNCONDITIONAL_MULTIPLE_EDGES'))
      .toBe(false);
  });

  it('a well-formed structured fork/join produces no parallel-structure errors', () => {
    const problems = validateWorkflow(wellFormedForkJoin());
    expect(hasProblem(problems, 'MIXED_FORK_EDGES')).toBe(false);
    expect(hasProblem(problems, 'FORK_WITHOUT_JOIN')).toBe(false);
    expect(hasProblem(problems, 'PARALLEL_BRANCH_REACHES_END')).toBe(false);
  });

  it('MIXED_FORK_EDGES when a node mixes unconditional and conditional edges', () => {
    const w = workflow(
      [node('start', 'start'), node('a', 'end'), node('b', 'end')],
      [edge('ea', 'start', 'a'), edge('eb', 'start', 'b', { condition: 'context.x == 1' })],
    );
    expect(hasProblem(validateWorkflow(w), 'MIXED_FORK_EDGES')).toBe(true);
  });

  it('PARALLEL_BRANCH_REACHES_END when a branch can hit END before the join', () => {
    const w = workflow(
      [node('start', 'start'), node('a', 'action'), node('b', 'action'),
        node('j', 'wait'), node('end', 'end')],
      [edge('fa', 'start', 'a'), edge('fb', 'start', 'b'),
        edge('aj', 'a', 'j'), edge('be', 'b', 'end'), edge('je', 'j', 'end')],
    );
    expect(hasProblem(validateWorkflow(w), 'PARALLEL_BRANCH_REACHES_END')).toBe(true);
  });

  it('skips parallel analysis when there are edge-reference errors', () => {
    const w = workflow(
      [node('start', 'start'), node('a', 'action'), node('end', 'end')],
      [edge('fa', 'start', 'a'), edge('fb', 'start', 'nonexistent'), edge('ae', 'a', 'end')],
    );
    const problems = validateWorkflow(w);
    expect(hasProblem(problems, 'INVALID_EDGE_TARGET')).toBe(true);
    // With a dangling target the graph is unsafe to traverse; no parallel-structure errors are added.
    expect(hasProblem(problems, 'FORK_WITHOUT_JOIN')).toBe(false);
    expect(hasProblem(problems, 'PARALLEL_BRANCH_REACHES_END')).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd ui && npx vitest run src/validation/validateWorkflow.test.ts`
Expected: FAIL — the `MIXED_FORK_EDGES` / `PARALLEL_BRANCH_REACHES_END` cases fail (codes not emitted
yet), and the "no longer emits" case fails (the warning is still emitted).

- [ ] **Step 3: Remove the retired warning**

In `ui/src/validation/validateWorkflow.ts`, delete the `UNCONDITIONAL_MULTIPLE_EDGES` block (currently
at ~lines 248–251):

```typescript
    const allUnconditional = outgoing.every(e => !e.condition || e.condition.trim() === '');
    if (allUnconditional && defaults.length === 0) {
      problems.push(problem('warning', 'UNCONDITIONAL_MULTIPLE_EDGES', 'Node has multiple outgoing edges with no conditions', sourceId));
    }
```

Delete those four lines outright. Leave the surrounding `MULTIPLE_DEFAULT_EDGES`, `NO_DEFAULT_EDGE`,
and `DUPLICATE_EDGE_PRIORITY` checks intact.

- [ ] **Step 4: Add the parallel-structure pass**

At the top of `ui/src/validation/validateWorkflow.ts`, add the import:

```typescript
import { analyzeParallelRegions } from '../simulation/parallelRegions.ts';
```

Wire a new pass into `validateWorkflow` (2-space indentation to match the file):

```typescript
export function validateWorkflow(workflow: Workflow): ValidationProblem[] {
  const problems: ValidationProblem[] = [];
  validateStructure(workflow, problems);
  validateConnectivity(workflow, problems);
  validateEdgeConditions(workflow, problems);
  validateSemantics(workflow, problems);
  validateParallelStructure(workflow, problems);
  return problems;
}
```

Add the function (place it near the other `validate*` functions):

```typescript
/**
 * Surfaces structured-parallelism problems from the shared fork/join analyzer. Skipped when the graph
 * already has edge-reference errors that would make traversal unsafe. Mirrors the Java
 * {@code WorkflowValidator.validateParallelStructure}.
 */
function validateParallelStructure(workflow: Workflow, problems: ValidationProblem[]) {
  const hasEdgeRefErrors = problems.some(p =>
    p.code === 'INVALID_EDGE_SOURCE' || p.code === 'INVALID_EDGE_TARGET');
  if (hasEdgeRefErrors) {
    return;
  }
  const regions = analyzeParallelRegions(workflow);
  for (const p of regions.problems) {
    problems.push(problem('error', p.code, messageForParallelProblem(p.code), p.nodeId));
  }
}

function messageForParallelProblem(code: string): string {
  switch (code) {
    case 'MIXED_FORK_EDGES':
      return 'Node mixes unconditional (fork) edges with conditional/default edges; make all outgoing '
        + 'edges unconditional to fork, or add conditions/a default for exclusive choice';
    case 'FORK_WITHOUT_JOIN':
      return 'Parallel branches from this fork do not re-converge at a single join';
    case 'PARALLEL_BRANCH_REACHES_END':
      return 'A parallel branch can reach an end node without first joining';
    default:
      return 'Invalid parallel structure';
  }
}
```

- [ ] **Step 5: Update the validation docs**

In `docs/user-guide/validation.md`, remove the `UNCONDITIONAL_MULTIPLE_EDGES` table row (line ~99) and
add rows for the three new codes in the same table (keep the existing column layout; do not reflow
table cells):

```markdown
| `MIXED_FORK_EDGES` | Node mixes unconditional (fork) edges with conditional/default edges |
| `FORK_WITHOUT_JOIN` | Parallel branches from a fork do not re-converge at a single join |
| `PARALLEL_BRANCH_REACHES_END` | A parallel branch can reach an end node without first joining |
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd ui && npx vitest run src/validation/validateWorkflow.test.ts`
Expected: PASS (new cases green; the rest of the file unchanged and still green).

- [ ] **Step 7: Typecheck**

Run: `cd ui && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add ui/src/validation/validateWorkflow.ts ui/src/validation/validateWorkflow.test.ts docs/user-guide/validation.md
git commit -m "feat(validation): retire UNCONDITIONAL_MULTIPLE_EDGES, add fork/join structural rules (#88)"
```

---

### Task 4: Simulation — convert to the active-branch token model (linear parity)

**Files:**
- Modify: `ui/src/simulation/simulate.ts` (reshape `SimState`; rewrite the lifecycle over branch
  tokens; **no fork/join yet** — a single `"root"` branch throughout)
- Test: `ui/src/simulation/simulate.test.ts` (existing tests must stay green; add branch-attribution
  assertions)

**Interfaces:**
- Consumes: `ActiveBranch` from `../types/instance.ts` (Task 1).
- Produces (for Task 5 and external consumers): `SimState` gains `activeBranches: ActiveBranch[]`,
  `parkedBranchIds: string[]`, `joinArrivals: Record<string, string[]>`; keeps `currentNodeId: string`
  and `blockedOn?: { nodeId; kind }` as **derived** back-compat fields. `resumeSimulation` gains an
  optional 4th parameter `nodeId?: string`. Internal helpers Task 5 extends: `moveBranch`,
  `enterNode`, `quiesce`, `derive`, `runnableBranch`, `completeBranchEntry`, `recordOutputOnBranch`.

**Design note (parity):** this mirrors the engine's token model with one branch. The engine keeps
`currentNodeId` as a derived accessor (sole node, else `null`); `SimState.currentNodeId` uses the same
idea but resolves to `''` (empty) rather than `null` when zero/≥2 branches are active, so the existing
Phase 3-owned UI (`SimulationPanel`, `WorkflowEditor`) — which reads `simState.currentNodeId` as a
`string` and `simState.blockedOn.nodeId`/`.kind` — keeps compiling untouched. History entries store
the actual `branchId` (`"root"` for the root branch), matching the engine.

- [ ] **Step 1: Add branch-attribution assertions to the existing test file**

Append to `ui/src/simulation/simulate.test.ts`:

```typescript
describe('active-branch model — linear parity', () => {
    it('runs a linear flow on the root branch with attributed history', () => {
        const wf = workflow(
            [node('start', 'start'), node('act', 'action'), node('end', 'end')],
            [edge('e1', 'start', 'act'), edge('e2', 'act', 'end')],
        );
        let state = startSimulation(wf, {});
        expect(state.activeBranches).toEqual([{ branchId: 'root', nodeId: 'start' }]);
        state = runSimulation(wf, state);
        expect(state.status).toBe('blocked');
        expect(state.currentNodeId).toBe('act');
        expect(state.blockedOn?.nodeId).toBe('act');
        expect(state.activeBranches).toEqual([{ branchId: 'root', nodeId: 'act' }]);
        state = resumeSimulation(wf, state, { output: { done: true } });
        state = runSimulation(wf, state);
        expect(state.status).toBe('completed');
        expect(state.history.every(h => h.branchId === 'root')).toBe(true);
    });
});
```

Run: `cd ui && npx vitest run src/simulation/simulate.test.ts`
Expected: FAIL — `activeBranches` is undefined on the current single-cursor `SimState`.

- [ ] **Step 2: Reshape `SimState` and add the `ActiveBranch` import**

In `ui/src/simulation/simulate.ts`, change the instance import and the `SimState` interface:

```typescript
import { type HistoryEntry, type ActiveBranch } from '../types/instance.ts';
```

Replace the `SimState` interface with:

```typescript
/** The complete, serializable state of a simulation run. */
export interface SimState {
    status: SimStatus;
    /** Live branch positions (tokens). Replaces the single cursor; mirrors the engine. */
    activeBranches: ActiveBranch[];
    /**
     * Derived, back-compat: the sole active node's id when exactly one branch is active, else `''`
     * (empty) when zero or multiple branches are active. Keeps existing single-path consumers working.
     */
    currentNodeId: string;
    /** Branch ids currently parked on a blocking node, awaiting a mock (not runnable). */
    parkedBranchIds: string[];
    /** Arrived incoming-edge ids per join node, awaiting the remaining branches. */
    joinArrivals: Record<string, string[]>;
    /** The evolving instance context (start context plus merged mock outputs). */
    context: Record<string, unknown>;
    /** Nodes entered so far, in order (may contain repeats for loops / multiple branches). */
    visitedNodeIds: string[];
    /** History entries, shaped like a real {@code WorkflowInstance} history (branch-attributed). */
    history: HistoryEntry[];
    /** Last routing evaluation per edge id, for the canvas overlay. */
    edgeEvaluations: Record<string, EdgeEvaluation>;
    /** Derived, back-compat: the first parked branch's node/kind when `status === 'blocked'`. */
    blockedOn?: { nodeId: string; kind: NodeType };
    /** Set when `status === 'failed'`. */
    error?: SimError;
    /** Number of transitions taken across all branches, for the loop guard. */
    transitions: number;
}
```

- [ ] **Step 3: Rewrite the lifecycle functions over branch tokens**

Replace `startSimulation`, `stepSimulation`, `runSimulation`, and `resumeSimulation` with:

```typescript
export function startSimulation(workflow: Workflow, context: Record<string, unknown>): SimState {
    const startNode = workflow.nodes.find(n => n.type === 'start');
    if (!startNode) {
        return {
            status: 'failed',
            activeBranches: [],
            currentNodeId: '',
            parkedBranchIds: [],
            joinArrivals: {},
            context: { ...context },
            visitedNodeIds: [],
            history: [],
            edgeEvaluations: {},
            error: { message: 'No start node found' },
            transitions: 0,
        };
    }
    return {
        status: 'running',
        activeBranches: [{ branchId: 'root', nodeId: startNode.id }],
        currentNodeId: startNode.id,
        parkedBranchIds: [],
        joinArrivals: {},
        context: { ...context },
        visitedNodeIds: [startNode.id],
        history: [{ ...enterEntry(startNode), branchId: 'root' }],
        edgeEvaluations: {},
        transitions: 0,
    };
}

/**
 * Advances the simulation by a single step: picks the first runnable branch and resolves its outgoing
 * edge, moving it to (and entering) the target. When no branch is runnable the state quiesces to a
 * blocked/terminal status. A no-op when the simulation is not `running`.
 */
export function stepSimulation(workflow: Workflow, state: SimState): SimState {
    if (state.status !== 'running') {
        return state;
    }
    if (state.transitions >= MAX_TRANSITIONS) {
        return derive(workflow, fail(state, {
            message: `Exceeded transition limit (${MAX_TRANSITIONS}) — possible infinite loop`,
            nodeId: state.currentNodeId || undefined,
        }));
    }
    const branch = runnableBranch(workflow, state);
    if (!branch) {
        return quiesce(workflow, state);
    }
    const node = findNode(workflow, branch.nodeId);
    if (!node) {
        return derive(workflow, fail(state, {
            message: `Current node not found: ${branch.nodeId}`, nodeId: branch.nodeId,
        }));
    }

    // Resolve the single outgoing edge (fork handling is added in Task 5).
    let selection: EdgeSelection;
    try {
        selection = selectEdge(workflow, node, { context: state.context });
    } catch (e) {
        if (e instanceof EdgeConditionError) {
            return derive(workflow, {
                ...fail(state, { message: e.message, nodeId: node.id, edgeId: e.edgeId }),
                edgeEvaluations: mergeEvaluations(state.edgeEvaluations, e.evaluations),
            });
        }
        throw e;
    }
    const edgeEvaluations = mergeEvaluations(state.edgeEvaluations, selection.evaluations);
    if (!selection.edge) {
        return derive(workflow, {
            ...fail(state, {
                message: `No matching outgoing edge from node: ${node.name || node.id}`,
                nodeId: node.id,
            }),
            edgeEvaluations,
        });
    }

    const history = completeBranchEntry(state.history, branch.branchId, node.id);
    const moved = moveBranch(
        workflow,
        { ...state, history, edgeEvaluations, transitions: state.transitions + 1 },
        branch.branchId,
        selection.edge,
    );
    return quiesce(workflow, moved);
}

/**
 * Runs the simulation forward until it blocks, completes, or fails. A no-op when not `running`.
 */
export function runSimulation(workflow: Workflow, state: SimState): SimState {
    let current = state;
    while (current.status === 'running') {
        const next = stepSimulation(workflow, current);
        if (next === current) {
            break;
        }
        current = next;
    }
    return current;
}

/**
 * Delivers a mock output/event to a parked (blocking) branch, merges any output into context (as a
 * real node would), and marks that branch runnable so the next step routes it onward. When `nodeId`
 * is given the matching parked branch is targeted; otherwise the first parked branch is resumed. A
 * no-op unless the simulation is `blocked`.
 */
export function resumeSimulation(
    workflow: Workflow,
    state: SimState,
    mock: SimMock,
    nodeId?: string,
): SimState {
    if (state.status !== 'blocked') {
        return state;
    }
    const parked = state.activeBranches.filter(b => state.parkedBranchIds.includes(b.branchId));
    const target = nodeId ? parked.find(b => b.nodeId === nodeId) : parked[0];
    if (!target) {
        return state;
    }
    const output = mock.output ?? {};
    const context = { ...state.context, ...output };
    const history = recordOutputOnBranch(state.history, target.branchId, target.nodeId, output);
    const parkedBranchIds = state.parkedBranchIds.filter(id => id !== target.branchId);
    return derive(workflow, { ...state, status: 'running', context, history, parkedBranchIds });
}
```

- [ ] **Step 4: Add the token-model internals and update `enterNode`**

Replace the existing `enterNode` and add the new helpers below it. Remove the now-unused
`completeLast` and `recordOutputOnLast` helpers (replaced by the branch-aware versions):

```typescript
/** @returns the first branch that is runnable (not parked, not sitting on an end node), or undefined. */
function runnableBranch(workflow: Workflow, state: SimState): ActiveBranch | undefined {
    return state.activeBranches.find(b =>
        !state.parkedBranchIds.includes(b.branchId) && findNode(workflow, b.nodeId)?.type !== 'end');
}

/**
 * Moves a branch across a single edge to its target and enters it. (Join synchronization is added in
 * Task 5.)
 */
function moveBranch(
    workflow: Workflow,
    state: SimState,
    branchId: string,
    edge: WorkflowEdge,
): SimState {
    const target = findNode(workflow, edge.target);
    if (!target) {
        return fail(state, { message: `Edge target not found: ${edge.target}`, edgeId: edge.id });
    }
    const activeBranches = state.activeBranches
        .filter(b => b.branchId !== branchId)
        .concat({ branchId, nodeId: target.id });
    return enterNode({ ...state, activeBranches }, workflow, branchId, target, edge);
}

/** Applies the type-specific behavior when a branch enters a node, recording branch-attributed history. */
function enterNode(
    state: SimState,
    workflow: Workflow,
    branchId: string,
    node: WorkflowNode,
    viaEdge?: WorkflowEdge,
): SimState {
    void workflow;
    const history = state.history.concat({ ...enterEntry(node, viaEdge), branchId });
    const visitedNodeIds = [...state.visitedNodeIds, node.id];
    const base: SimState = { ...state, history, visitedNodeIds };

    if (node.type === 'end') {
        // END completes the whole run and cancels siblings.
        return {
            ...base,
            status: 'completed',
            history: completeBranchEntry(base.history, branchId, node.id),
            activeBranches: [],
            parkedBranchIds: [],
            joinArrivals: {},
        };
    }
    if (node.type === 'start') {
        return fail(base, { message: 'Cannot transition to a start node', nodeId: node.id });
    }
    if (BLOCKING_KINDS.has(node.type)) {
        return { ...base, parkedBranchIds: [...base.parkedBranchIds, branchId] };
    }
    // 'wait' — routable in the simulation; the branch stays runnable and the next step routes it.
    return base;
}

/**
 * Derives the instance status once no branch is runnable: `blocked` when a branch is parked, a
 * defensive `failed` on an empty non-terminal state, otherwise `running`. Always recomputes the
 * derived `currentNodeId`/`blockedOn`.
 */
function quiesce(workflow: Workflow, state: SimState): SimState {
    if (state.status !== 'running') {
        return derive(workflow, state);
    }
    if (runnableBranch(workflow, state)) {
        return derive(workflow, state);
    }
    if (state.activeBranches.length === 0) {
        return derive(workflow, fail(state, {
            message: 'No active branches and the simulation did not complete (parallel deadlock)',
        }));
    }
    return derive(workflow, { ...state, status: 'blocked' });
}

/** Recomputes the derived back-compat fields (`currentNodeId`, `blockedOn`) from the branch set. */
function derive(workflow: Workflow, state: SimState): SimState {
    const currentNodeId = state.activeBranches.length === 1 ? state.activeBranches[0].nodeId : '';
    let blockedOn: SimState['blockedOn'];
    if (state.status === 'blocked') {
        const firstParked = state.activeBranches.find(b => state.parkedBranchIds.includes(b.branchId));
        const node = firstParked ? findNode(workflow, firstParked.nodeId) : undefined;
        if (node) {
            blockedOn = { nodeId: node.id, kind: node.type };
        }
    }
    return { ...state, currentNodeId, blockedOn };
}

/** Marks the open (not-yet-completed) history entry for `(branchId, nodeId)` completed. */
function completeBranchEntry(history: HistoryEntry[], branchId: string, nodeId: string): HistoryEntry[] {
    const copy = history.slice();
    for (let i = copy.length - 1; i >= 0; i--) {
        const e = copy[i];
        if (e.branchId === branchId && e.nodeId === nodeId && !e.completedOn) {
            copy[i] = { ...e, completedOn: new Date().toISOString() };
            return copy;
        }
    }
    return copy;
}

/** Records the produced output on the open history entry for `(branchId, nodeId)`. */
function recordOutputOnBranch(
    history: HistoryEntry[],
    branchId: string,
    nodeId: string,
    output: Record<string, unknown>,
): HistoryEntry[] {
    const copy = history.slice();
    for (let i = copy.length - 1; i >= 0; i--) {
        const e = copy[i];
        if (e.branchId === branchId && e.nodeId === nodeId && !e.completedOn) {
            copy[i] = { ...e, output: { ...(e.output ?? {}), ...output } };
            return copy;
        }
    }
    return copy;
}
```

Note: `enterEntry`, `findNode`, `fail`, `mergeEvaluations`, `selectEdge`, `EdgeSelection`, and
`EdgeConditionError` are unchanged and remain in the file.

- [ ] **Step 5: Run the full simulation suite**

Run: `cd ui && npx vitest run src/simulation/simulate.test.ts`
Expected: PASS — all pre-existing single-cursor tests still pass (they assert `currentNodeId` /
`blockedOn`, both preserved), plus the new branch-attribution test.

- [ ] **Step 6: Typecheck**

Run: `cd ui && npx tsc --noEmit`
Expected: PASS (the Phase 3-owned `SimulationPanel`/`WorkflowEditor` still compile against the derived
`currentNodeId`/`blockedOn`).

- [ ] **Step 7: Commit**

```bash
git add ui/src/simulation/simulate.ts ui/src/simulation/simulate.test.ts
git commit -m "refactor(sim): active-branch token model (linear parity) (#88)"
```

---

### Task 5: Simulation — fork fan-out and AND-join synchronization

**Files:**
- Modify: `ui/src/simulation/simulate.ts` (add fork handling in `stepSimulation`; add join handling in
  `moveBranch`; thread the analysis through)
- Test: `ui/src/simulation/simulate.test.ts` (parallel behavior mirroring `WorkflowEngineParallelTest`)

**Interfaces:**
- Consumes: `analyzeParallelRegions` / `ParallelAnalysis` from `./parallelRegions.ts` (Task 2);
  `moveBranch`, `enterNode`, `quiesce`, `completeBranchEntry` from Task 4.
- Produces: fork nodes fan out into child branches (`"<parent>.<i>"`); joins wait for all incoming
  edges then continue as `"<joinNodeId>#join"`.

- [ ] **Step 1: Write the failing parallel tests**

Append to `ui/src/simulation/simulate.test.ts`:

```typescript
describe('fork / AND-join', () => {
    // start -> f(fork) -> a, b ; a -> j, b -> j ; j -> end. a and b are actions (block for a mock).
    function forkJoin(): Workflow {
        return workflow(
            [node('start', 'start'), node('f', 'wait'), node('a', 'action'), node('b', 'action'),
                node('j', 'wait'), node('end', 'end')],
            [edge('s', 'start', 'f'), edge('fa', 'f', 'a'), edge('fb', 'f', 'b'),
                edge('aj', 'a', 'j'), edge('bj', 'b', 'j'), edge('je', 'j', 'end')],
        );
    }

    it('fans out into both branches and parks each on its action', () => {
        const state = runSimulation(forkJoin(), startSimulation(forkJoin(), {}));
        expect(state.status).toBe('blocked');
        const parkedNodes = state.activeBranches
            .filter(b => state.parkedBranchIds.includes(b.branchId))
            .map(b => b.nodeId)
            .sort();
        expect(parkedNodes).toEqual(['a', 'b']);
        expect(state.currentNodeId).toBe(''); // two active branches -> no single current node
    });

    it('waits for all branches, then fires the join once and completes', () => {
        const wf = forkJoin();
        let state = runSimulation(wf, startSimulation(wf, {}));
        // resume branch at 'a' only -> join must NOT fire yet; sibling 'b' still blocked
        state = resumeSimulation(wf, state, { output: { fromA: 1 } }, 'a');
        state = runSimulation(wf, state);
        expect(state.status).toBe('blocked');
        expect(state.visitedNodeIds.filter(id => id === 'j')).toHaveLength(0);
        // resume branch at 'b' -> all arrived -> join fires once -> end
        state = resumeSimulation(wf, state, { output: { fromB: 2 } }, 'b');
        state = runSimulation(wf, state);
        expect(state.status).toBe('completed');
        expect(state.visitedNodeIds.filter(id => id === 'j')).toHaveLength(1);
        expect(state.context).toMatchObject({ fromA: 1, fromB: 2 });
    });

    it('attributes branch history to distinct child branch ids', () => {
        const wf = forkJoin();
        const state = runSimulation(wf, startSimulation(wf, {}));
        const branchIds = new Set(state.history.map(h => h.branchId));
        expect(branchIds.has('root.0')).toBe(true);
        expect(branchIds.has('root.1')).toBe(true);
    });

    it('fails the whole simulation when one branch cannot route', () => {
        // branch 'b' leads to a node with a condition that never matches and no default -> no edge.
        const wf = workflow(
            [node('start', 'start'), node('f', 'wait'), node('a', 'wait'), node('b', 'wait'),
                node('j', 'wait'), node('dead', 'wait'), node('end', 'end')],
            [edge('s', 'start', 'f'), edge('fa', 'f', 'a'), edge('fb', 'f', 'b'),
                edge('aj', 'a', 'j'), edge('bd', 'b', 'dead', { condition: 'context.never == true' }),
                edge('je', 'j', 'end')],
        );
        const state = runSimulation(wf, startSimulation(wf, {}));
        expect(state.status).toBe('failed');
        expect(state.error?.message).toContain('No matching outgoing edge');
    });

    it('handles a nested fork/join and completes once', () => {
        // start -> f -> a, g(inner fork) ; g -> c, d ; c -> ij, d -> ij ; ij -> j ; a -> j ; j -> end
        const wf = workflow(
            [node('start', 'start'), node('f', 'wait'), node('a', 'wait'), node('g', 'wait'),
                node('c', 'wait'), node('d', 'wait'), node('ij', 'wait'), node('j', 'wait'),
                node('end', 'end')],
            [edge('s', 'start', 'f'), edge('fa', 'f', 'a'), edge('fg', 'f', 'g'),
                edge('gc', 'g', 'c'), edge('gd', 'g', 'd'), edge('cij', 'c', 'ij'), edge('dij', 'd', 'ij'),
                edge('ijj', 'ij', 'j'), edge('aj', 'a', 'j'), edge('je', 'j', 'end')],
        );
        const state = runSimulation(wf, startSimulation(wf, {}));
        expect(state.status).toBe('completed');
        expect(state.visitedNodeIds.filter(id => id === 'j')).toHaveLength(1);
        expect(state.visitedNodeIds.filter(id => id === 'ij')).toHaveLength(1);
    });
});
```

Run: `cd ui && npx vitest run src/simulation/simulate.test.ts`
Expected: FAIL — forks are not yet handled (a fork node currently routes to the first edge only via
`selectEdge`, so both-branch fan-out and join synchronization don't occur).

- [ ] **Step 2: Add the analyzer import**

At the top of `ui/src/simulation/simulate.ts`:

```typescript
import { analyzeParallelRegions, type ParallelAnalysis } from './parallelRegions.ts';
```

- [ ] **Step 3: Add fork fan-out to `stepSimulation`**

In `stepSimulation`, immediately after the `if (!node) { ... }` guard and **before** the
`selectEdge` call, insert the fork branch. Then thread `regions` into the sequential `moveBranch` call
too:

```typescript
    const regions = analyzeParallelRegions(workflow);

    // Fork: retire this branch and fan out one child branch per outgoing edge.
    if (regions.isFork(node.id)) {
        const forkEdges = workflow.edges.filter(e => e.source === node.id);
        const forkEvals: EdgeEvaluation[] = forkEdges.map(e => ({
            edgeId: e.id, condition: e.condition, isDefault: false, result: 'matched',
        }));
        let next: SimState = {
            ...state,
            history: completeBranchEntry(state.history, branch.branchId, node.id),
            edgeEvaluations: mergeEvaluations(state.edgeEvaluations, forkEvals),
            transitions: state.transitions + 1,
            activeBranches: state.activeBranches.filter(b => b.branchId !== branch.branchId),
        };
        let childIndex = 0;
        for (const edge of forkEdges) {
            const childBranchId = `${branch.branchId}.${childIndex++}`;
            next = { ...next, activeBranches: [...next.activeBranches, { branchId: childBranchId, nodeId: node.id }] };
            next = moveBranch(workflow, next, childBranchId, edge, regions);
            if (next.status !== 'running') {
                return derive(workflow, next); // END/failure inside a branch cancels the rest
            }
        }
        return quiesce(workflow, next);
    }
```

Then update the sequential `moveBranch` call at the end of `stepSimulation` to pass `regions`:

```typescript
    const moved = moveBranch(
        workflow,
        { ...state, history, edgeEvaluations, transitions: state.transitions + 1 },
        branch.branchId,
        selection.edge,
        regions,
    );
```

- [ ] **Step 4: Add join synchronization to `moveBranch`**

Change `moveBranch`'s signature to accept `regions` and handle the join case:

```typescript
function moveBranch(
    workflow: Workflow,
    state: SimState,
    branchId: string,
    edge: WorkflowEdge,
    regions: ParallelAnalysis,
): SimState {
    const target = findNode(workflow, edge.target);
    if (!target) {
        return fail(state, { message: `Edge target not found: ${edge.target}`, edgeId: edge.id });
    }

    if (regions.isJoin(target.id)) {
        // Record arrival; retire the arriving branch.
        const arrived = [...(state.joinArrivals[target.id] ?? []), edge.id];
        const withArrival: SimState = {
            ...state,
            joinArrivals: { ...state.joinArrivals, [target.id]: arrived },
            activeBranches: state.activeBranches.filter(b => b.branchId !== branchId),
            parkedBranchIds: state.parkedBranchIds.filter(id => id !== branchId),
        };
        const required = regions.incomingEdgeIds(target.id);
        const arrivedSet = new Set(arrived);
        const allArrived = [...required].every(id => arrivedSet.has(id));
        if (!allArrived) {
            return withArrival; // absorbed; wait for the remaining branches
        }
        // All branches converged: one continuing branch enters the join. Clear this join's arrivals
        // so a legitimate loop-back to the same region starts clean.
        const clearedArrivals = { ...withArrival.joinArrivals };
        delete clearedArrivals[target.id];
        const continuingId = `${target.id}#join`;
        const fired: SimState = {
            ...withArrival,
            joinArrivals: clearedArrivals,
            activeBranches: [...withArrival.activeBranches, { branchId: continuingId, nodeId: target.id }],
        };
        return enterNode(fired, workflow, continuingId, target, edge);
    }

    // Sequential / fork-child arrival at a normal node.
    const activeBranches = state.activeBranches
        .filter(b => b.branchId !== branchId)
        .concat({ branchId, nodeId: target.id });
    return enterNode({ ...state, activeBranches }, workflow, branchId, target, edge);
}
```

- [ ] **Step 5: Run the parallel suite**

Run: `cd ui && npx vitest run src/simulation/simulate.test.ts`
Expected: PASS (fork/join cases green; linear cases from Task 4 still green).

- [ ] **Step 6: Full verification**

Run all of:
- `cd ui && npx vitest run` — Expected: PASS (whole UI suite).
- `cd ui && npx tsc --noEmit` — Expected: PASS.
- `cd ui && npm run lint` — Expected: PASS (no new lint errors).
- `cd ui && npm run build` — Expected: PASS (library build succeeds).

- [ ] **Step 7: Commit**

```bash
git add ui/src/simulation/simulate.ts ui/src/simulation/simulate.test.ts
git commit -m "feat(sim): fork fan-out and AND-join synchronization (#88)"
```

---

## Self-Review

**1. Spec coverage (Phase 2 scope, spec §"Phased delivery" 2 + §Validation + §"TS simulation"):**

- `types/instance.ts` active branches + `HistoryEntry.branchId` → Task 1. ✓
- Shared TS fork→join analysis helper (parity with `ParallelRegions.java`, emitting the three engine
  codes) → Task 2. ✓
- `validateWorkflow.ts` retire `UNCONDITIONAL_MULTIPLE_EDGES` + new structural rules via the shared
  helper + docs update → Task 3. ✓
- `simulate.ts` token model: active-branch set, fork returns all edges, AND-join waits for all,
  blocking parks per-branch, END cancels siblings, fail-fast → Tasks 4 (model) + 5 (fork/join). ✓
- Tests mirroring engine coverage (`simulate.test.ts`, `validateWorkflow.test.ts`, plus analyzer
  tests) → Tasks 2, 3, 5. Engine cases covered: fork activates all, join waits+fires once, fail-fast,
  branch parks while sibling proceeds, nested fork/join, branch-attributed history, resume-by-node. ✓
- Out of scope for Phase 2 (deferred to Phase 3–5, correctly excluded): `WorkflowViewer`
  multi-active, `SimulationPanel`/`WorkflowEditor` UI, `nodeHistory` grouping, docs beyond the retired
  code, worked CVE example. The plan keeps those files compiling via derived `currentNodeId`/
  `blockedOn` rather than modifying them. ✓
- Deliberately **not** emitted (parity with Phase 1): `UNBALANCED_PARALLEL`,
  `CROSSING_PARALLEL_REGIONS`, `PARALLEL_REGION_CYCLE`. Documented in Global Constraints. ✓

**2. Placeholder scan:** No `TBD`/`TODO`/"handle edge cases"/"similar to Task N". Every code and test
step contains complete, runnable content. ✓

**3. Type consistency:** `ActiveBranch` defined in Task 1, imported by Tasks 4/5. `SimState` fields
(`activeBranches`, `parkedBranchIds`, `joinArrivals`, derived `currentNodeId`/`blockedOn`) are
consistent across Tasks 4 and 5. `analyzeParallelRegions`/`ParallelAnalysis`/`ParallelProblem`
signatures are identical where produced (Task 2) and consumed (Tasks 3, 5). `moveBranch` gains its
`regions: ParallelAnalysis` parameter in Task 5 and every call site is updated in the same task.
`completeBranchEntry`/`recordOutputOnBranch` match `(history, branchId, nodeId[, output])` at all uses.
Branch-id scheme (`"root"`, `"<parent>.<i>"`, `"<join>#join"`) is used identically in engine and
plan. ✓
