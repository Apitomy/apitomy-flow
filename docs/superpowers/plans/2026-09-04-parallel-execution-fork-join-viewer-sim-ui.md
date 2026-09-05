# Parallel Execution Fork/Join — Phase 3: Viewer + Simulation UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended)
> or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`)
> syntax for tracking.

**Goal:** Make the `@apitomy/flow-ui` viewer, editor simulation overlay, and simulation panel render
concurrent fork/join branches — multi-active node highlighting, all-active edge animation,
branch-aware node detail, and a multi-branch simulation panel — instead of the single-cursor model.

**Architecture:** All multi-branch derivation is extracted into pure, framework-free helpers
(`utils/parallelView.ts`, extended `utils/nodeHistory.ts`) that are unit-tested with vitest. The React
components (`WorkflowViewer.tsx`, `WorkflowEditor.tsx`, `SimulationPanel.tsx`) become thin renderers
that call those helpers and read the branch collections (`activeBranches`, `parkedBranchIds`,
branch-attributed `history`) already produced by the Phase 1/2 engine and simulator, rather than the
scalar back-compat fields (`currentNodeId`, `blockedOn`).

**Tech Stack:** TypeScript + React 19, `@xyflow/react` (React Flow v12), Vite, vitest (no
`@testing-library/react` / jsdom — testable logic is kept pure).

**Spec:** `docs/superpowers/specs/2026-09-04-parallel-execution-fork-join-design.md` (Phase 3, under
"UI impact" and "Phased delivery").

## Global Constraints

- All commands run from the `ui/` directory. Gates: `npx vitest run`, `npx tsc --noEmit`,
  `npm run lint`, `npm run build` — all must pass before a task is complete.
- No jsdom / React component tests. Only pure logic gets unit tests (vitest). Component changes are
  verified by typecheck + lint + build only.
- Match each file's existing indentation: `ui/src/utils/*.ts` and the React components
  (`WorkflowViewer.tsx`, `WorkflowEditor.tsx`, `SimulationPanel.tsx`) use **2-space** indent. New
  `utils/parallelView.ts` uses 2-space.
- Every public function gets a JSDoc docstring.
- Branch-id back-compat: a `HistoryEntry` with `branchId === undefined` denotes the root branch; the
  root `ActiveBranch` uses `branchId === 'root'`. Any matching of branches against history entries
  MUST treat `entry.branchId ?? 'root'` as the entry's branch.
- Phase 3 is presentation-only. Do NOT change `simulation/simulate.ts`, `simulation/parallelRegions.ts`,
  `validation/*`, or any `types/*`. Their outputs are the inputs to this phase.
- This work lands on the existing `issues/gh-88` branch (PR #97), continuing issue #88 — do not open a
  new branch off `main` for delivery (a scratch worktree during SDD is fine; integrate back onto
  `issues/gh-88`).

---

### Task 1: Pure branch-view helpers (`parallelView.ts`)

**Files:**
- Create: `ui/src/utils/parallelView.ts`
- Test: `ui/src/utils/parallelView.test.ts`

**Interfaces:**
- Consumes: `ActiveBranch`, `HistoryEntry` from `../types/instance.ts`; `NodeType` from
  `../types/workflow.ts`.
- Produces (relied on by Tasks 3, 4, 5):
  - `activeNodeIds(branches: ActiveBranch[], parkedBranchIds?: readonly string[]): Set<string>`
  - `activeEdgeIds(branches: ActiveBranch[], history: HistoryEntry[]): Set<string>`
  - `parkedNodes(branches: ActiveBranch[], parkedBranchIds: readonly string[], nodeType: (nodeId: string) => NodeType | undefined): ParkedNode[]`
    where `interface ParkedNode { nodeId: string; kind: NodeType; branchId: string }`
  - `branchPaths(history: HistoryEntry[]): BranchPath[]`
    where `interface BranchPath { branchId: string; nodeIds: string[] }`
  - `simNodeClass(nodeId: string, opts: SimNodeClassOpts): string`
    where `interface SimNodeClassOpts { activeIds: Set<string>; parkedIds: Set<string>; visited: ReadonlySet<string>; failedNodeId?: string }`

- [ ] **Step 1: Write the failing tests**

Create `ui/src/utils/parallelView.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { type ActiveBranch, type HistoryEntry } from '../types/instance.ts';
import { type NodeType } from '../types/workflow.ts';
import {
  activeNodeIds,
  activeEdgeIds,
  parkedNodes,
  branchPaths,
  simNodeClass,
} from './parallelView.ts';

function branch(branchId: string, nodeId: string): ActiveBranch {
  return { branchId, nodeId };
}
function entry(nodeId: string, extra: Partial<HistoryEntry> = {}): HistoryEntry {
  return { nodeId, nodeName: nodeId, enteredOn: '2026-01-01T00:00:00Z', ...extra };
}

describe('activeNodeIds', () => {
  it('returns every branch node when no parked ids are given', () => {
    const set = activeNodeIds([branch('root.0', 'a'), branch('root.1', 'b')]);
    expect(set).toEqual(new Set(['a', 'b']));
  });

  it('excludes branches whose id is parked', () => {
    const set = activeNodeIds(
      [branch('root.0', 'a'), branch('root.1', 'b')],
      ['root.1'],
    );
    expect(set).toEqual(new Set(['a']));
  });

  it('returns an empty set for no branches', () => {
    expect(activeNodeIds([])).toEqual(new Set());
  });
});

describe('activeEdgeIds', () => {
  it('collects the arrival edge of each active branch (latest matching visit)', () => {
    const history: HistoryEntry[] = [
      entry('a', { branchId: 'root.0', edgeId: 'e-fa' }),
      entry('b', { branchId: 'root.1', edgeId: 'e-fb' }),
    ];
    const set = activeEdgeIds([branch('root.0', 'a'), branch('root.1', 'b')], history);
    expect(set).toEqual(new Set(['e-fa', 'e-fb']));
  });

  it('uses the most recent matching visit when a branch loops back to a node', () => {
    const history: HistoryEntry[] = [
      entry('a', { branchId: 'root', edgeId: 'e1' }),
      entry('a', { branchId: 'root', edgeId: 'e2' }),
    ];
    expect(activeEdgeIds([branch('root', 'a')], history)).toEqual(new Set(['e2']));
  });

  it('treats a missing history branchId as the root branch', () => {
    const history: HistoryEntry[] = [entry('a', { edgeId: 'e1' })];
    expect(activeEdgeIds([branch('root', 'a')], history)).toEqual(new Set(['e1']));
  });

  it('omits branches with no arrival edge (e.g. the start node)', () => {
    const history: HistoryEntry[] = [entry('start', { branchId: 'root' })];
    expect(activeEdgeIds([branch('root', 'start')], history)).toEqual(new Set());
  });
});

describe('parkedNodes', () => {
  const kinds: Record<string, NodeType> = { a: 'action', w: 'wait' };
  const lookup = (id: string): NodeType | undefined => kinds[id];

  it('returns one entry per parked branch with its node kind and branch id', () => {
    const result = parkedNodes(
      [branch('root.0', 'a'), branch('root.1', 'w')],
      ['root.0', 'root.1'],
      lookup,
    );
    expect(result).toEqual([
      { nodeId: 'a', kind: 'action', branchId: 'root.0' },
      { nodeId: 'w', kind: 'wait', branchId: 'root.1' },
    ]);
  });

  it('ignores non-parked branches', () => {
    const result = parkedNodes([branch('root.0', 'a'), branch('root.1', 'w')], ['root.1'], lookup);
    expect(result).toEqual([{ nodeId: 'w', kind: 'wait', branchId: 'root.1' }]);
  });

  it('drops parked branches whose node type cannot be resolved', () => {
    const result = parkedNodes([branch('root.0', 'gone')], ['root.0'], lookup);
    expect(result).toEqual([]);
  });
});

describe('branchPaths', () => {
  it('groups history nodes per branch, preserving first-appearance branch order', () => {
    const history: HistoryEntry[] = [
      entry('start', { branchId: 'root' }),
      entry('a', { branchId: 'root.0' }),
      entry('b', { branchId: 'root.1' }),
      entry('a2', { branchId: 'root.0' }),
    ];
    expect(branchPaths(history)).toEqual([
      { branchId: 'root', nodeIds: ['start'] },
      { branchId: 'root.0', nodeIds: ['a', 'a2'] },
      { branchId: 'root.1', nodeIds: ['b'] },
    ]);
  });

  it('treats a missing branchId as the root branch', () => {
    const history: HistoryEntry[] = [entry('start'), entry('next')];
    expect(branchPaths(history)).toEqual([{ branchId: 'root', nodeIds: ['start', 'next'] }]);
  });

  it('returns an empty array for empty history', () => {
    expect(branchPaths([])).toEqual([]);
  });
});

describe('simNodeClass', () => {
  const base = { activeIds: new Set<string>(), parkedIds: new Set<string>(), visited: new Set<string>() };

  it('marks the failed node when a failure is present', () => {
    expect(simNodeClass('x', { ...base, activeIds: new Set(['x']), failedNodeId: 'x' }))
      .toBe('flow-sim-node-failed');
  });

  it('marks a parked node as blocked', () => {
    expect(simNodeClass('x', { ...base, parkedIds: new Set(['x']) })).toBe('flow-sim-node-blocked');
  });

  it('marks an active (non-parked) node as current', () => {
    expect(simNodeClass('x', { ...base, activeIds: new Set(['x']) })).toBe('flow-sim-node-current');
  });

  it('prefers blocked over current when a node is both', () => {
    expect(simNodeClass('x', { ...base, activeIds: new Set(['x']), parkedIds: new Set(['x']) }))
      .toBe('flow-sim-node-blocked');
  });

  it('marks a visited-but-inactive node as visited', () => {
    expect(simNodeClass('x', { ...base, visited: new Set(['x']) })).toBe('flow-sim-node-visited');
  });

  it('marks an untouched node as idle', () => {
    expect(simNodeClass('x', base)).toBe('flow-sim-node-idle');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd ui && npx vitest run src/utils/parallelView.test.ts`
Expected: FAIL — `Failed to resolve import "./parallelView.ts"` / functions not defined.

- [ ] **Step 3: Write the implementation**

Create `ui/src/utils/parallelView.ts`:

```typescript
import { type ActiveBranch, type HistoryEntry } from '../types/instance.ts';
import { type NodeType } from '../types/workflow.ts';

/** A branch parked on a blocking node, with the node kind resolved for display. */
export interface ParkedNode {
  nodeId: string;
  kind: NodeType;
  branchId: string;
}

/** The ordered node path taken by a single branch. */
export interface BranchPath {
  branchId: string;
  nodeIds: string[];
}

/** Inputs for {@link simNodeClass}. */
export interface SimNodeClassOpts {
  /** Node ids of currently-active (runnable) branches. */
  activeIds: Set<string>;
  /** Node ids of parked (blocked) branches. */
  parkedIds: Set<string>;
  /** Node ids visited at any point in the run. */
  visited: ReadonlySet<string>;
  /** The failing node id when the run has failed; omitted otherwise. */
  failedNodeId?: string;
}

/** The branch id an entry belongs to, treating a missing value as the root branch. */
function entryBranchId(entry: HistoryEntry): string {
  return entry.branchId ?? 'root';
}

/**
 * The set of node ids where branches currently sit.
 *
 * @param branches the live branch tokens
 * @param parkedBranchIds branch ids to exclude (parked/blocked); omit to include every branch
 * @returns a set of node ids (never null)
 */
export function activeNodeIds(
  branches: ActiveBranch[],
  parkedBranchIds?: readonly string[],
): Set<string> {
  const parked = parkedBranchIds ? new Set(parkedBranchIds) : undefined;
  const ids = new Set<string>();
  for (const branch of branches) {
    if (parked && parked.has(branch.branchId)) continue;
    ids.add(branch.nodeId);
  }
  return ids;
}

/**
 * The set of arrival edge ids for the currently-active branches: for each branch, the edge id of the
 * most recent history entry matching that branch and its current node.
 *
 * @param branches the live branch tokens
 * @param history the full, branch-attributed history
 * @returns a set of edge ids (branches with no arrival edge, e.g. the start node, contribute nothing)
 */
export function activeEdgeIds(branches: ActiveBranch[], history: HistoryEntry[]): Set<string> {
  const edges = new Set<string>();
  for (const branch of branches) {
    let arrivalEdgeId: string | undefined;
    for (const entry of history) {
      if (entry.nodeId === branch.nodeId && entryBranchId(entry) === branch.branchId && entry.edgeId) {
        arrivalEdgeId = entry.edgeId;
      }
    }
    if (arrivalEdgeId) edges.add(arrivalEdgeId);
  }
  return edges;
}

/**
 * Resolves the parked (blocked) branches to displayable {@link ParkedNode}s.
 *
 * @param branches the live branch tokens
 * @param parkedBranchIds branch ids that are parked on a blocking node
 * @param nodeType resolves a node id to its type (undefined when the node is unknown)
 * @returns one entry per parked branch whose node type resolves, in branch order
 */
export function parkedNodes(
  branches: ActiveBranch[],
  parkedBranchIds: readonly string[],
  nodeType: (nodeId: string) => NodeType | undefined,
): ParkedNode[] {
  const parked = new Set(parkedBranchIds);
  const result: ParkedNode[] = [];
  for (const branch of branches) {
    if (!parked.has(branch.branchId)) continue;
    const kind = nodeType(branch.nodeId);
    if (!kind) continue;
    result.push({ nodeId: branch.nodeId, kind, branchId: branch.branchId });
  }
  return result;
}

/**
 * Groups a branch-attributed history into per-branch ordered paths.
 *
 * @param history the full, branch-attributed history
 * @returns one {@link BranchPath} per branch, in the order each branch first appears
 */
export function branchPaths(history: HistoryEntry[]): BranchPath[] {
  const order: string[] = [];
  const byBranch = new Map<string, string[]>();
  for (const entry of history) {
    const branchId = entryBranchId(entry);
    let nodeIds = byBranch.get(branchId);
    if (!nodeIds) {
      nodeIds = [];
      byBranch.set(branchId, nodeIds);
      order.push(branchId);
    }
    nodeIds.push(entry.nodeId);
  }
  return order.map(branchId => ({ branchId, nodeIds: byBranch.get(branchId)! }));
}

/**
 * The simulation overlay CSS class for a node, given the multi-branch run state. Precedence:
 * failed > blocked (parked) > current (active) > visited > idle.
 *
 * @param nodeId the node to classify
 * @param opts the active/parked/visited sets and optional failing node id
 * @returns one of `flow-sim-node-{failed,blocked,current,visited,idle}`
 */
export function simNodeClass(nodeId: string, opts: SimNodeClassOpts): string {
  if (opts.failedNodeId && nodeId === opts.failedNodeId) return 'flow-sim-node-failed';
  if (opts.parkedIds.has(nodeId)) return 'flow-sim-node-blocked';
  if (opts.activeIds.has(nodeId)) return 'flow-sim-node-current';
  return opts.visited.has(nodeId) ? 'flow-sim-node-visited' : 'flow-sim-node-idle';
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd ui && npx vitest run src/utils/parallelView.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Typecheck and lint**

Run: `cd ui && npx tsc --noEmit && npm run lint`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add ui/src/utils/parallelView.ts ui/src/utils/parallelView.test.ts
git commit -m "Add pure branch-view helpers for parallel viewer/sim UI (#88)"
```

---

### Task 2: Branch grouping in `nodeHistory.ts`

**Files:**
- Modify: `ui/src/utils/nodeHistory.ts`
- Test: `ui/src/utils/nodeHistory.test.ts`

**Interfaces:**
- Consumes: `HistoryEntry` from `../types/instance.ts`.
- Produces (relied on by Task 3):
  - `nodeVisitsByBranch(history: HistoryEntry[], nodeId: string | null): NodeBranchVisits[]`
    where `interface NodeBranchVisits { branchId: string; visits: HistoryEntry[] }`
  - Existing `nodeVisits(history, nodeId)` is unchanged.

- [ ] **Step 1: Write the failing tests**

Add to `ui/src/utils/nodeHistory.test.ts` (keep existing tests). Ensure the import line includes the
new symbol:

```typescript
import { nodeVisits, nodeVisitsByBranch } from './nodeHistory.ts';
```

Add this describe block:

```typescript
describe('nodeVisitsByBranch', () => {
  const h = (nodeId: string, branchId?: string): HistoryEntry => ({
    nodeId, nodeName: nodeId, enteredOn: '2026-01-01T00:00:00Z', branchId,
  });

  it('returns an empty array when nodeId is null', () => {
    expect(nodeVisitsByBranch([h('a', 'root')], null)).toEqual([]);
  });

  it('returns an empty array when the node was never visited', () => {
    expect(nodeVisitsByBranch([h('a', 'root')], 'b')).toEqual([]);
  });

  it('groups a node visited across multiple branches, in first-appearance order', () => {
    const history = [h('a', 'root.1'), h('a', 'root.0'), h('a', 'root.1')];
    const result = nodeVisitsByBranch(history, 'a');
    expect(result.map(g => g.branchId)).toEqual(['root.1', 'root.0']);
    expect(result[0].visits).toHaveLength(2);
    expect(result[1].visits).toHaveLength(1);
  });

  it('treats a missing branchId as the root branch', () => {
    const result = nodeVisitsByBranch([h('a'), h('a')], 'a');
    expect(result).toEqual([{ branchId: 'root', visits: [h('a'), h('a')] }]);
  });
});
```

If `nodeHistory.test.ts` does not already import `HistoryEntry`, add:
`import { type HistoryEntry } from '../types/instance.ts';`

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd ui && npx vitest run src/utils/nodeHistory.test.ts`
Expected: FAIL — `nodeVisitsByBranch` is not exported.

- [ ] **Step 3: Write the implementation**

Add to `ui/src/utils/nodeHistory.ts` (below the existing `nodeVisits`):

```typescript
/** A node's visits within a single branch. */
export interface NodeBranchVisits {
  branchId: string;
  visits: HistoryEntry[];
}

/**
 * Groups a node's visits by branch, so a node reached concurrently (or repeatedly) across parallel
 * branches can be shown per-branch. Branches appear in the order they are first seen in the history.
 * A visit whose {@link HistoryEntry.branchId} is absent is attributed to the root branch.
 *
 * @param history the full instance history
 * @param nodeId the id of the node whose visits should be grouped
 * @returns one group per branch that visited the node (empty when never visited or nodeId is null)
 */
export function nodeVisitsByBranch(history: HistoryEntry[], nodeId: string | null): NodeBranchVisits[] {
  if (!nodeId) return [];
  const order: string[] = [];
  const byBranch = new Map<string, HistoryEntry[]>();
  for (const entry of history) {
    if (entry.nodeId !== nodeId) continue;
    const branchId = entry.branchId ?? 'root';
    let visits = byBranch.get(branchId);
    if (!visits) {
      visits = [];
      byBranch.set(branchId, visits);
      order.push(branchId);
    }
    visits.push(entry);
  }
  return order.map(branchId => ({ branchId, visits: byBranch.get(branchId)! }));
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd ui && npx vitest run src/utils/nodeHistory.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck and lint**

Run: `cd ui && npx tsc --noEmit && npm run lint`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add ui/src/utils/nodeHistory.ts ui/src/utils/nodeHistory.test.ts
git commit -m "Add branch-grouped node-history helper (#88)"
```

---

### Task 3: Multi-active highlighting + branch-aware NodeDetail in `WorkflowViewer`

**Files:**
- Modify: `ui/src/components/WorkflowViewer.tsx`

**Interfaces:**
- Consumes: `activeNodeIds`, `activeEdgeIds` from `../utils/parallelView.ts`; `nodeVisitsByBranch`
  from `../utils/nodeHistory.ts`; `instance.activeBranches`, `instance.history`,
  `instance.currentNodeId`, `instance.status` from the existing `WorkflowInstance`.
- Produces: no new exports; behavioral change only. Verified by typecheck/lint/build (no component
  unit test — project convention).

This task has no vitest step (component-only). The verification steps are typecheck, lint, and build.

- [ ] **Step 1: Add the helper imports**

In `ui/src/components/WorkflowViewer.tsx`, add near the existing util imports (after the
`nodeVisits` import on line 8):

```typescript
import { nodeVisits, nodeVisitsByBranch } from '../utils/nodeHistory.ts';
import { activeNodeIds, activeEdgeIds } from '../utils/parallelView.ts';
```

(Replace the existing single `nodeVisits` import line with the two lines above.)

- [ ] **Step 2: Compute the active node/edge sets**

Replace the `nodes` and `edges` `useMemo` blocks (currently lines ~70–109) so highlighting is
driven by the active-branch sets. Add these memos immediately before the `nodes` memo:

```typescript
  // Nodes where branches currently sit. At a terminal state the branch set is empty, so fall back to
  // the preserved terminal/failing node id to keep completed/failed highlighting unchanged.
  const activeIds = useMemo(
    () => (isTerminal
      ? new Set([instance.currentNodeId].filter((id): id is string => !!id))
      : activeNodeIds(instance.activeBranches)),
    [isTerminal, instance.currentNodeId, instance.activeBranches],
  );

  // Arrival edges of the currently-active branches (empty at terminal states).
  const activeEdges = useMemo(
    () => (isTerminal ? new Set<string>() : activeEdgeIds(instance.activeBranches, instance.history)),
    [isTerminal, instance.activeBranches, instance.history],
  );
```

Then change the `nodes` memo to test set membership instead of `=== instance.currentNodeId`:

```typescript
  const nodes = useMemo(() => {
    return toReactFlowNodes(laidOutNodes).map(node => {
      const isCurrent = activeIds.has(node.id);
      const isVisited = visitedNodeIds.has(node.id);
      let className: string;
      if (isCurrent && isTerminal) {
        className = instance.status === 'failed' ? 'flow-node-failed'
          : instance.status === 'cancelled' ? 'flow-node-cancelled'
          : 'flow-node-visited';
      } else if (isCurrent) {
        className = 'flow-node-current';
      } else if (isVisited) {
        className = 'flow-node-visited';
      } else {
        className = 'flow-node-unvisited';
      }
      return {
        ...node,
        data: { ...node.data, isCurrent: isCurrent && !isTerminal },
        className,
        draggable: false,
      };
    });
  }, [laidOutNodes, activeIds, instance.status, isTerminal, visitedNodeIds]);
```

And change the `edges` memo to animate every active arrival edge:

```typescript
  const edges = useMemo(() => {
    return toReactFlowEdges(workflow.edges).map(edge => {
      const isVisited = visitedEdgeIds.has(edge.id);
      return {
        ...edge,
        style: {
          ...edge.style,
          strokeWidth: isVisited ? 2.5 : 1,
          stroke: isVisited ? 'var(--flow-status-success, #3e8635)' : undefined,
          opacity: isVisited ? 1 : 0.3,
        },
        animated: !isTerminal && activeEdges.has(edge.id),
      };
    });
  }, [workflow.edges, visitedEdgeIds, activeEdges, isTerminal]);
```

- [ ] **Step 3: Make `NodeDetail` branch-aware**

The panel currently derives `selectedNodeVisits` from `nodeVisits` and passes a single flat visit
list to `NodeDetail`. Keep `selectedNodeVisits` (still used for the flat index math) and add a
grouped view. Immediately after the existing `selectedNodeVisits` memo (line ~128) add:

```typescript
  const selectedNodeVisitsByBranch = useMemo(
    () => nodeVisitsByBranch(instance.history, selectedNodeId),
    [selectedNodeId, instance.history],
  );
```

Change the `isCurrent` prop passed to `NodeDetail` from `selectedNodeId === instance.currentNodeId`
to set membership, and pass the grouped visits and the flat visits:

```typescript
            <NodeDetail
              node={selectedWorkflowNode}
              history={selectedNodeHistory}
              visits={selectedNodeVisits}
              visitsByBranch={selectedNodeVisitsByBranch}
              visitIndex={effectiveVisitIndex}
              onSelectVisit={setSelectedVisitIndex}
              isCurrent={selectedNodeId ? activeIds.has(selectedNodeId) : false}
              instanceStatus={instance.status}
            />
```

Update the `NodeDetail` component signature and its visit `<select>` to group by branch. Change the
props type to add `visitsByBranch` and import the `NodeBranchVisits` type:

```typescript
import { nodeVisits, nodeVisitsByBranch, type NodeBranchVisits } from '../utils/nodeHistory.ts';
```

(Merge this with the import added in Step 1 — the final import is the single line above.)

In the `NodeDetail` signature, add the new prop:

```typescript
function NodeDetail({ node, history, visits, visitsByBranch, visitIndex, onSelectVisit, isCurrent, instanceStatus }: {
  node: WorkflowViewerProps['workflow']['nodes'][number] | null;
  history: HistoryEntry | null;
  visits: HistoryEntry[];
  visitsByBranch: NodeBranchVisits[];
  visitIndex: number;
  onSelectVisit: (index: number) => void;
  isCurrent: boolean;
  instanceStatus: InstanceStatus;
}) {
```

Replace the visit `<select>` (currently rendered when `visits.length > 1`) so its options are grouped
by branch when more than one branch visited the node. The `<option>` value must remain the index into
the flat `visits` array so `onSelectVisit`/`effectiveVisitIndex` math is unchanged. Use `indexOf`
against the flat `visits` array to map each grouped entry back to its flat index:

```typescript
      {visits.length > 1 && (
        <select
          className="workflow-viewer__visit-select"
          value={visitIndex}
          onChange={(e) => onSelectVisit(Number(e.target.value))}
          aria-label="Select visit"
        >
          {visitsByBranch.length > 1
            ? visitsByBranch.map(group => (
                <optgroup key={group.branchId} label={`Branch ${group.branchId}`}>
                  {group.visits.map(visit => {
                    const index = visits.indexOf(visit);
                    return (
                      <option key={index} value={index}>
                        Visit {index + 1} of {visits.length} — {new Date(visit.enteredOn).toLocaleString()}
                      </option>
                    );
                  })}
                </optgroup>
              ))
            : visits.map((visit, index) => (
                <option key={index} value={index}>
                  Visit {index + 1} of {visits.length} — {new Date(visit.enteredOn).toLocaleString()}
                </option>
              ))}
        </select>
      )}
```

Add a "Branch" detail row so the selected visit's branch is visible. Insert after the existing "Node
ID" `context-entry` block:

```typescript
      {history?.branchId && history.branchId !== 'root' && (
        <div className="workflow-viewer__context-entry">
          <span className="workflow-viewer__context-key">Branch</span>
          <span className="workflow-viewer__context-value">{history.branchId}</span>
        </div>
      )}
```

- [ ] **Step 4: Typecheck, lint, build**

Run: `cd ui && npx tsc --noEmit && npm run lint && npm run build`
Expected: all clean. (`nodeVisits` remains imported and used for `selectedNodeVisits`; confirm no
unused-import lint error — if the flat `nodeVisits` is still used it stays, which it is.)

- [ ] **Step 5: Run the full test suite (guard against regressions)**

Run: `cd ui && npx vitest run`
Expected: PASS (no viewer unit tests exist; this confirms nothing else broke).

- [ ] **Step 6: Commit**

```bash
git add ui/src/components/WorkflowViewer.tsx
git commit -m "Render multiple active branches and branch-aware detail in WorkflowViewer (#88)"
```

---

### Task 4: Editor simulation overlay uses shared `simNodeClass` + resume targeting

**Files:**
- Modify: `ui/src/components/WorkflowEditor.tsx`

**Interfaces:**
- Consumes: `simNodeClass`, `activeNodeIds`, `parkedNodes` (for parked ids) from
  `../utils/parallelView.ts`; `SimState` fields `activeBranches`, `parkedBranchIds`,
  `visitedNodeIds`, `error`, `status`; `resumeSimulation(workflow, state, mock, nodeId?)` (already
  supports the optional `nodeId`).
- Produces: `resumeSim` is widened to `(mock: SimMock, nodeId?: string) => void` and threads `nodeId`
  into `resumeSimulation`. This is the callback passed as `SimulationPanel`'s `onResume` (whose type
  Task 5 widens to match).

This task has no vitest step (component-only). Verified by typecheck/lint/build.

- [ ] **Step 1: Remove the local `simNodeClass` and import the shared helper**

Delete the local `simNodeClass` function (currently lines ~86–93). Add the import near the other util
imports:

```typescript
import { simNodeClass, activeNodeIds } from '../utils/parallelView.ts';
```

- [ ] **Step 2: Compute the overlay sets from the branch model**

In the `simNodes` memo (currently lines ~495–498), replace the single-cursor computation with the
active/parked sets:

```typescript
  const simNodes = useMemo(() => {
    if (!simActive || !simState) return nodesWithValidation;
    const visited = new Set(simState.visitedNodeIds);
    const parkedIds = activeNodeIds(
      simState.activeBranches.filter(b => simState.parkedBranchIds.includes(b.branchId)),
    );
    const activeIds = activeNodeIds(simState.activeBranches, simState.parkedBranchIds);
    const failedNodeId = simState.status === 'failed' ? simState.error?.nodeId : undefined;
    return nodesWithValidation.map(n => ({
      ...n,
      className: simNodeClass(n.id, { activeIds, parkedIds, visited, failedNodeId }),
    }));
  }, [nodesWithValidation, simActive, simState]);
```

- [ ] **Step 3: Thread the target node id through `resumeSim`**

Change `resumeSim` (currently lines ~452–454) to accept and forward the parked node id:

```typescript
  const resumeSim = useCallback((mock: SimMock, nodeId?: string) => {
    setSimState(prev => (prev ? resumeSimulation(currentWorkflow, prev, mock, nodeId) : prev));
  }, [currentWorkflow]);
```

- [ ] **Step 4: Typecheck, lint, build**

Run: `cd ui && npx tsc --noEmit && npm run lint && npm run build`
Expected: all clean. (Passing the wider `resumeSim` to the still-narrow `onResume` prop typechecks;
Task 5 widens the prop type.)

- [ ] **Step 5: Run the full test suite (guard against regressions)**

Run: `cd ui && npx vitest run`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add ui/src/components/WorkflowEditor.tsx
git commit -m "Drive editor sim overlay from the active-branch set (#88)"
```

---

### Task 5: Multi-branch `SimulationPanel` (active list, blocked selector, grouped path)

**Files:**
- Modify: `ui/src/components/panels/SimulationPanel.tsx`

**Interfaces:**
- Consumes: `activeNodeIds`, `parkedNodes`, `branchPaths`, `type ParkedNode` from
  `../../utils/parallelView.ts`; `SimState` fields `activeBranches`, `parkedBranchIds`, `history`,
  `status`.
- Produces: `SimulationPanelProps.onResume` widened to `(mock: SimMock, nodeId?: string) => void`
  (matches the `resumeSim` from Task 4).

This task has no vitest step (component-only). Verified by typecheck/lint/build.

- [ ] **Step 1: Add imports and widen the `onResume` prop**

Add the helper import:

```typescript
import { activeNodeIds, parkedNodes, branchPaths, type ParkedNode } from '../../utils/parallelView.ts';
```

Widen the `onResume` prop in `SimulationPanelProps`:

```typescript
  /** Delivers a mock output/event to a specific blocked node (by id) and continues. */
  onResume: (mock: SimMock, nodeId?: string) => void;
```

- [ ] **Step 2: Replace single-cursor derivations with branch-aware ones**

Replace the `blockedNode` / `blockedNodeId` derivation (currently lines ~98–101) with the parked-node
list and a selection. Use a node-type lookup closure over `workflow.nodes`:

```typescript
  const nodeType = (nodeId: string) => workflow.nodes.find(n => n.id === nodeId)?.type;
  const parked: ParkedNode[] = simState
    ? parkedNodes(simState.activeBranches, simState.parkedBranchIds, nodeType)
    : [];
  const activeNodeList = simState
    ? [...activeNodeIds(simState.activeBranches, simState.parkedBranchIds)]
    : [];

  // The parked node the mock editor currently targets. Default to the first parked node; reset when
  // the current selection is no longer parked (adjusting state during render is React's recommended
  // pattern for resetting state on a derived "key" change).
  const [selectedParkedId, setSelectedParkedId] = useState<string | undefined>(undefined);
  const selectedParked =
    parked.find(p => p.nodeId === selectedParkedId) ?? parked[0];
  if (parked.length > 0 && selectedParked && selectedParked.nodeId !== selectedParkedId) {
    setSelectedParkedId(selectedParked.nodeId);
  }
  const selectedParkedNode = selectedParked
    ? workflow.nodes.find(n => n.id === selectedParked.nodeId)
    : undefined;
```

- [ ] **Step 3: Re-scaffold the mock editor on the selected parked node**

Replace the existing `seededFor` re-scaffold block (currently lines ~106–110) so it keys off the
selected parked node instead of `blockedOn`:

```typescript
  const selectedParkedNodeId = selectedParked?.nodeId;
  if (selectedParkedNodeId && selectedParkedNodeId !== seededFor) {
    setSeededFor(selectedParkedNodeId);
    setMockText(scaffoldOutputs(selectedParkedNode));
    setMockError(null);
  }
```

- [ ] **Step 4: Update `handleContinue` to target the selected node**

```typescript
  const handleContinue = () => {
    if (!selectedParked) return;
    const result = parseObject(mockText);
    if (!result.ok) {
      setMockError(result.error);
      return;
    }
    setMockError(null);
    onResume({ output: result.value }, selectedParked.nodeId);
  };
```

- [ ] **Step 5: Render active nodes, the blocked selector, and per-branch paths**

Replace the status "at &lt;node&gt;" block (currently lines ~189–200) with an active-nodes list:

```typescript
        {simState && (
          <div className="simulation-panel__status">
            <span className={`simulation-panel__badge is-${simState.status}`}>
              {STATUS_LABEL[simState.status]}
            </span>
            {activeNodeList.map(nodeId => (
              <button
                key={nodeId}
                className="simulation-panel__link"
                onClick={() => onFocusNode(nodeId)}
              >
                {workflow.nodes.find(n => n.id === nodeId)?.name || nodeId}
              </button>
            ))}
          </div>
        )}
```

Replace the blocked section (currently lines ~202–223) with a picker across all parked nodes plus the
mock editor for the selected one:

```typescript
        {simState?.status === 'blocked' && selectedParked && (
          <div className="simulation-panel__block">
            {parked.length > 1 && (
              <select
                className="simulation-panel__block-select"
                value={selectedParked.nodeId}
                onChange={(e) => setSelectedParkedId(e.target.value)}
                aria-label="Select blocked node"
              >
                {parked.map(p => (
                  <option key={p.branchId} value={p.nodeId}>
                    {(workflow.nodes.find(n => n.id === p.nodeId)?.name || p.nodeId)} ({p.kind})
                    {p.branchId !== 'root' ? ` — ${p.branchId}` : ''}
                  </option>
                ))}
              </select>
            )}
            <div className="simulation-panel__block-title">
              Blocked at{' '}
              <button className="simulation-panel__link" onClick={() => onFocusNode(selectedParked.nodeId)}>
                {selectedParkedNode?.name || selectedParked.nodeId}
              </button>{' '}
              <span className="simulation-panel__kind">({selectedParked.kind})</span>
            </div>
            <label>Mock output — merged into context (JSON)</label>
            <JsonCodeEditor
              value={mockText}
              onChange={setMockText}
              minRows={5}
              ariaLabel="Mock output (JSON)"
            />
            {mockError && <div className="simulation-panel__error-text">{mockError}</div>}
            <button className="simulation-panel__primary" onClick={handleContinue}>
              Deliver &amp; continue
            </button>
          </div>
        )}
```

Replace the single "Path" block (currently lines ~244–257) with per-branch paths:

```typescript
        {simState && simState.history.length > 0 && (
          <div className="simulation-panel__field">
            <label>Path</label>
            {branchPaths(simState.history).map(bp => (
              <div key={bp.branchId} className="simulation-panel__branch-path">
                {bp.branchId !== 'root' && (
                  <div className="simulation-panel__branch-label">Branch {bp.branchId}</div>
                )}
                <ol className="simulation-panel__path">
                  {bp.nodeIds.map((nodeId, i) => (
                    <li key={`${nodeId}-${i}`}>
                      <button className="simulation-panel__link" onClick={() => onFocusNode(nodeId)}>
                        {workflow.nodes.find(n => n.id === nodeId)?.name || nodeId}
                      </button>
                    </li>
                  ))}
                </ol>
              </div>
            ))}
          </div>
        )}
```

- [ ] **Step 6: Add minimal CSS for the new elements**

Append to `ui/src/components/panels/SimulationPanel.css` (match existing spacing/vars):

```css
.simulation-panel__block-select {
  width: 100%;
  margin-bottom: 8px;
}

.simulation-panel__branch-path {
  margin-bottom: 8px;
}

.simulation-panel__branch-label {
  font-size: 0.8em;
  opacity: 0.7;
  margin-bottom: 2px;
}
```

- [ ] **Step 7: Typecheck, lint, build**

Run: `cd ui && npx tsc --noEmit && npm run lint && npm run build`
Expected: all clean. Confirm no unused symbols remain (the old `blockedNode`/`blockedNodeId`
references and the `simState.currentNodeId` status link are fully replaced).

- [ ] **Step 8: Run the full test suite (guard against regressions)**

Run: `cd ui && npx vitest run`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add ui/src/components/panels/SimulationPanel.tsx ui/src/components/panels/SimulationPanel.css
git commit -m "Show concurrent branches in the simulation panel with per-node resume (#88)"
```

---

## Self-Review

**Spec coverage:**
- "Multi-active highlighting in `WorkflowViewer`" → Task 3 (node set membership, `data.isCurrent` per
  active node, all-active edge animation). ✅
- "branch-aware `NodeDetail`/`nodeHistory`" → Task 2 (`nodeVisitsByBranch`) + Task 3 (grouped visit
  selector, Branch row, membership `isCurrent`). ✅
- "multi-branch `SimulationPanel`" → Task 5 (active list, blocked selector [one-at-a-time per the
  decision], per-branch grouped path). ✅
- "editor per-node/per-edge simulation overlay classes computed from the active-branch set" → Task 4
  (`simNodeClass` from active/parked sets; edge overlay already per-edge from `edgeEvaluations`, left
  unchanged). ✅
- Shared, tested pure helper → Task 1 (`parallelView.ts`). ✅
- Decisions honored: one-at-a-time blocked selector (Task 5 Step 5); animate all active arrivals
  (Task 3 Step 2); path grouped by branch (Task 5 Step 5). ✅

**Placeholder scan:** No TBD/TODO; every code step contains complete code. ✅

**Type consistency:**
- `activeNodeIds(branches, parkedBranchIds?)` — same signature in Task 1 (def), Task 3 (viewer, one
  arg), Task 4 (editor, two args), Task 5 (panel, two args). ✅
- `parkedNodes(branches, parkedBranchIds, nodeType)` returns `ParkedNode[]` — used in Task 5. ✅
- `branchPaths(history)` returns `BranchPath[]` — used in Task 5. ✅
- `simNodeClass(nodeId, { activeIds, parkedIds, visited, failedNodeId })` — def Task 1, call Task 4.
  ✅
- `nodeVisitsByBranch(history, nodeId)` returns `NodeBranchVisits[]` — def Task 2, used Task 3. ✅
- `onResume`/`resumeSim` widened to `(mock: SimMock, nodeId?: string) => void` in both Task 4 (impl)
  and Task 5 (prop type). ✅
- Phase-3 read-only contract respected: no task edits `simulate.ts`, `parallelRegions.ts`,
  `validation/*`, or `types/*`. `resumeSimulation`'s optional `nodeId` already exists. ✅
