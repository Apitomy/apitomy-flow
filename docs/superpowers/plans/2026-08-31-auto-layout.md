# Auto-Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended)
> or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`)
> syntax for tracking.

**Goal:** Give Apitomy Flow automatic graph layout so workflows are always readable — via a manual
"Tidy up" button, an editor fallback that persists positions, and a viewer fallback for display.

**Architecture:** A single pure function `layoutWorkflow()` (backed by `@dagrejs/dagre`) computes
node positions from the domain `WorkflowNode`/`WorkflowEdge` types, plus a `needsLayout()` predicate
that detects degenerate coordinates. `WorkflowEditor` and `WorkflowViewer` call these; the pure
module holds all testable logic (no React, no jsdom), matching the project convention.

**Tech Stack:** TypeScript, React 19, `@xyflow/react` v12, `@dagrejs/dagre`, vitest.

**Spec:** `docs/superpowers/specs/2026-08-31-auto-layout-design.md`

## Global Constraints

- Library: use `@dagrejs/dagre` (the maintained fork), added to `dependencies` in `ui/package.json`.
- Default layout direction is left-to-right (`LR`). No UI control to change it.
- The core module must be pure (operate on `WorkflowNode`/`WorkflowEdge`, no React Flow objects) and
  must not mutate its inputs.
- All commands run from the `ui/` directory.
- Verify every change with `npx vitest run` (affected tests) and `npx tsc --noEmit` before considering
  a task done. Run `npm run lint` for tasks touching components.
- Do not run maven; do not auto-run the full build. Run only the test/typecheck/lint commands listed.
- Follow existing code style: 2-space indent (match surrounding files), explicit types, `.ts`/`.tsx`
  import extensions as used throughout `ui/src`.

---

### Task 1: Core layout engine (`layoutWorkflow` + `needsLayout`)

**Files:**
- Modify: `ui/package.json` (add `@dagrejs/dagre` to `dependencies`)
- Create: `ui/src/layout/layoutWorkflow.ts`
- Test: `ui/src/layout/layoutWorkflow.test.ts`

**Interfaces:**
- Consumes: `WorkflowNode`, `WorkflowEdge`, `NodeType` from `../types/workflow.ts`.
- Produces:
  - `NODE_DIMENSIONS: Record<NodeType, { width: number; height: number }>` and
    `DEFAULT_NODE_DIMENSION: { width: number; height: number }`.
  - `interface LayoutOptions { direction?: 'LR' | 'TB'; nodeSpacing?: number; rankSpacing?: number;
    nodeSize?: (node: WorkflowNode) => { width: number; height: number }; }`
  - `function layoutWorkflow(nodes: WorkflowNode[], edges: WorkflowEdge[], options?: LayoutOptions):
    WorkflowNode[]` — returns a new array with updated `position`; never mutates input.
  - `function needsLayout(nodes: WorkflowNode[]): boolean`.

- [ ] **Step 1: Add the dependency**

Run (from `ui/`):
```bash
npm install @dagrejs/dagre@^1.1.4
```
Confirm `@dagrejs/dagre` now appears under `"dependencies"` (not `devDependencies`) in
`ui/package.json`. If npm placed it elsewhere, move the line into `"dependencies"`.

- [ ] **Step 2: Write the failing tests**

Create `ui/src/layout/layoutWorkflow.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { layoutWorkflow, needsLayout } from './layoutWorkflow.ts';
import { type WorkflowNode, type WorkflowEdge } from '../types/workflow.ts';

function node(id: string, type: WorkflowNode['type'], x = 0, y = 0): WorkflowNode {
  return { id, type, name: id, config: {}, position: { x, y } };
}

function edge(source: string, target: string): WorkflowEdge {
  return { id: `e-${source}-${target}`, source, target, priority: 0, isDefault: false };
}

describe('layoutWorkflow', () => {
  it('orders a linear graph left-to-right', () => {
    const nodes = [node('s', 'start'), node('a', 'action'), node('e', 'end')];
    const edges = [edge('s', 'a'), edge('a', 'e')];
    const laid = layoutWorkflow(nodes, edges);
    const byId = Object.fromEntries(laid.map(n => [n.id, n.position]));
    expect(byId.s.x).toBeLessThan(byId.a.x);
    expect(byId.a.x).toBeLessThan(byId.e.x);
  });

  it('produces distinct positions for sibling branches (no overlap)', () => {
    const nodes = [node('s', 'start'), node('a', 'action'), node('b', 'action'), node('e', 'end')];
    const edges = [edge('s', 'a'), edge('s', 'b'), edge('a', 'e'), edge('b', 'e')];
    const laid = layoutWorkflow(nodes, edges);
    const positions = laid.map(n => `${n.position.x},${n.position.y}`);
    expect(new Set(positions).size).toBe(positions.length);
  });

  it('terminates and returns finite positions when the graph has a cycle', () => {
    const nodes = [node('s', 'start'), node('a', 'action'), node('b', 'action')];
    const edges = [edge('s', 'a'), edge('a', 'b'), edge('b', 'a')];
    const laid = layoutWorkflow(nodes, edges);
    for (const n of laid) {
      expect(Number.isFinite(n.position.x)).toBe(true);
      expect(Number.isFinite(n.position.y)).toBe(true);
    }
  });

  it('handles empty and single-node graphs', () => {
    expect(layoutWorkflow([], [])).toEqual([]);
    const one = layoutWorkflow([node('s', 'start')], []);
    expect(one).toHaveLength(1);
    expect(Number.isFinite(one[0].position.x)).toBe(true);
  });

  it('does not mutate the input nodes', () => {
    const nodes = [node('s', 'start', 5, 5)];
    layoutWorkflow(nodes, []);
    expect(nodes[0].position).toEqual({ x: 5, y: 5 });
  });
});

describe('needsLayout', () => {
  it('is true when a node is missing a position', () => {
    const n = { id: 's', type: 'start', name: 's', config: {} } as unknown as WorkflowNode;
    expect(needsLayout([n])).toBe(true);
  });

  it('is true when all nodes share the same coordinate (e.g. origin)', () => {
    expect(needsLayout([node('s', 'start', 0, 0), node('a', 'action', 0, 0)])).toBe(true);
  });

  it('is false for a spread-out, intentionally placed graph', () => {
    expect(needsLayout([node('s', 'start', 0, 0), node('a', 'action', 200, 0)])).toBe(false);
  });

  it('is false for an empty graph', () => {
    expect(needsLayout([])).toBe(false);
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run src/layout/layoutWorkflow.test.ts`
Expected: FAIL — module `./layoutWorkflow.ts` does not exist.

- [ ] **Step 4: Implement the module**

Create `ui/src/layout/layoutWorkflow.ts`:
```ts
import dagre from '@dagrejs/dagre';
import { type WorkflowNode, type WorkflowEdge, type NodeType } from '../types/workflow.ts';

export const DEFAULT_NODE_DIMENSION = { width: 180, height: 50 };

export const NODE_DIMENSIONS: Record<NodeType, { width: number; height: number }> = {
  'start': { width: 120, height: 44 },
  'end': { width: 120, height: 44 },
  'action': { width: 180, height: 50 },
  'human-task': { width: 200, height: 50 },
  'receive-event': { width: 200, height: 50 },
  'wait': { width: 160, height: 50 },
};

export interface LayoutOptions {
  direction?: 'LR' | 'TB';
  nodeSpacing?: number;
  rankSpacing?: number;
  nodeSize?: (node: WorkflowNode) => { width: number; height: number };
}

function sizeOf(node: WorkflowNode, options?: LayoutOptions): { width: number; height: number } {
  if (options?.nodeSize) return options.nodeSize(node);
  return NODE_DIMENSIONS[node.type] ?? DEFAULT_NODE_DIMENSION;
}

/**
 * Compute positions for a workflow graph using a layered (dagre) layout.
 *
 * Returns a new array of nodes with updated `position` values; the input
 * nodes are never mutated. Cycles are handled (greedy acyclifier) so
 * loop-back edges do not hang the layout.
 *
 * @param nodes the workflow nodes to position
 * @param edges the workflow edges connecting the nodes
 * @param options layout direction, spacing, and optional node sizing
 * @returns a new node array with computed positions
 */
export function layoutWorkflow(
  nodes: WorkflowNode[],
  edges: WorkflowEdge[],
  options?: LayoutOptions,
): WorkflowNode[] {
  if (nodes.length === 0) return [];

  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({
    rankdir: options?.direction ?? 'LR',
    nodesep: options?.nodeSpacing ?? 60,
    ranksep: options?.rankSpacing ?? 90,
    acyclicer: 'greedy',
  });

  const dims = new Map<string, { width: number; height: number }>();
  for (const node of nodes) {
    const size = sizeOf(node, options);
    dims.set(node.id, size);
    g.setNode(node.id, { width: size.width, height: size.height });
  }

  const nodeIds = new Set(nodes.map(n => n.id));
  for (const edge of edges) {
    if (nodeIds.has(edge.source) && nodeIds.has(edge.target)) {
      g.setEdge(edge.source, edge.target);
    }
  }

  dagre.layout(g);

  return nodes.map(node => {
    const laidOut = g.node(node.id);
    const size = dims.get(node.id) ?? DEFAULT_NODE_DIMENSION;
    // dagre returns node centers; React Flow positions are top-left.
    return {
      ...node,
      position: {
        x: laidOut.x - size.width / 2,
        y: laidOut.y - size.height / 2,
      },
    };
  });
}

/**
 * Decide whether a workflow's node positions are degenerate and should be
 * auto-laid-out. Returns true when any node lacks a valid position, or when
 * every node shares effectively the same coordinate (e.g. all at the origin).
 *
 * @param nodes the workflow nodes to inspect
 * @returns true if the graph should be auto-laid-out
 */
export function needsLayout(nodes: WorkflowNode[]): boolean {
  if (nodes.length === 0) return false;

  for (const node of nodes) {
    const p = node.position;
    if (!p || typeof p.x !== 'number' || typeof p.y !== 'number'
        || !Number.isFinite(p.x) || !Number.isFinite(p.y)) {
      return true;
    }
  }

  if (nodes.length === 1) return true;

  const first = nodes[0].position;
  const allSame = nodes.every(n =>
    Math.abs(n.position.x - first.x) < 1 && Math.abs(n.position.y - first.y) < 1);
  return allSame;
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/layout/layoutWorkflow.test.ts`
Expected: PASS (all cases).

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add ui/package.json ui/package-lock.json ui/src/layout/layoutWorkflow.ts ui/src/layout/layoutWorkflow.test.ts
git commit -m "feat(ui): dagre-based workflow layout engine"
```

---

### Task 2: Editor "Tidy up" button

**Files:**
- Modify: `ui/src/components/WorkflowEditor.tsx`

**Interfaces:**
- Consumes: `layoutWorkflow` from `../layout/layoutWorkflow.ts`; existing `toWorkflowNodes` /
  `toReactFlowNodes` from `../utils/conversion.ts`; existing `takeSnapshot`, `setNodes`,
  `changeNeededRef`, `fitView`, `nodes`, `edges` in `WorkflowEditorInner`.
- Produces: a `handleTidyUp` callback wired to a toolbar button. No new exports.

- [ ] **Step 1: Add the import**

At the top of `ui/src/components/WorkflowEditor.tsx`, add alongside the other util imports:
```ts
import { layoutWorkflow } from '../layout/layoutWorkflow.ts';
import { toWorkflowNodes } from '../utils/conversion.ts';
```
(Extend the existing `../utils/conversion.ts` import instead of duplicating it if that reads cleaner.)

- [ ] **Step 2: Add the `handleTidyUp` callback**

Inside `WorkflowEditorInner`, near the other `useCallback` handlers (e.g. after `onNodeDragStop`),
add:
```ts
const handleTidyUp = useCallback(() => {
  takeSnapshot(nodes, edges);
  const workflowNodes = toWorkflowNodes(nodes);
  const laidOut = layoutWorkflow(workflowNodes, toWorkflowEdges(edges));
  const positionById = new Map(laidOut.map(n => [n.id, n.position]));
  setNodes(nds => nds.map(n => {
    const pos = positionById.get(n.id);
    return pos ? { ...n, position: pos } : n;
  }));
  changeNeededRef.current = true;
  window.requestAnimationFrame(() => fitView({ duration: 300 }));
}, [nodes, edges, takeSnapshot, setNodes, fitView]);
```
Ensure `toWorkflowEdges` is imported from `../utils/conversion.ts` (add it to the import list).

- [ ] **Step 3: Add the toolbar button**

In the `<Panel position="top-right">` toolbar (the `div.workflow-editor__toolbar`), add a button after
Redo:
```tsx
<button title="Tidy up (auto-layout)" onClick={handleTidyUp}>
  Tidy up
</button>
```

- [ ] **Step 4: Typecheck and lint**

Run: `npx tsc --noEmit`
Expected: no errors.
Run: `npm run lint`
Expected: no errors.

- [ ] **Step 5: Manual verification**

Run: `npm run dev`, open <http://localhost:5173/>, drag a few nodes into a mess, click **Tidy up**,
confirm the graph re-flows left-to-right and that a single Undo (Ctrl+Z) restores the pre-tidy
positions. Stop the dev server when done.

- [ ] **Step 6: Commit**

```bash
git add ui/src/components/WorkflowEditor.tsx
git commit -m "feat(ui): Tidy up auto-layout button in WorkflowEditor"
```

---

### Task 3: Editor fallback on load (persist positions)

**Files:**
- Modify: `ui/src/components/WorkflowEditor.tsx`

**Interfaces:**
- Consumes: `needsLayout`, `layoutWorkflow` from `../layout/layoutWorkflow.ts`; existing
  `initialNodes` `useMemo`, `toWorkflow`, `onChange`, `nodes`, `edges`.
- Produces: laid-out `initialNodes` when the incoming workflow has degenerate positions, plus a
  one-time `onChange` so the host persists the computed coordinates.

- [ ] **Step 1: Lay out degenerate workflows for the initial state**

Change the `initialNodes` memo so it runs layout when needed. Replace:
```ts
const initialNodes = useMemo(() => toReactFlowNodes(workflow.nodes), []);
```
with:
```ts
const initialNodes = useMemo(() => {
  const source = needsLayout(workflow.nodes)
    ? layoutWorkflow(workflow.nodes, workflow.edges)
    : workflow.nodes;
  return toReactFlowNodes(source);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- convert once on mount
}, []);
```
Add `needsLayout` to the layout import from Task 2.

- [ ] **Step 2: Persist the computed positions once, on mount**

Add a one-time effect (near the existing initialization effect) that emits `onChange` when a fallback
layout was applied, so the host saves real coordinates:
```ts
const fallbackAppliedRef = useRef(needsLayout(workflow.nodes));
useEffect(() => {
  if (fallbackAppliedRef.current) {
    fallbackAppliedRef.current = false;
    onChange(toWorkflow(workflow, initialNodes, initialEdges));
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- run once for fallback persistence
}, []);
```

- [ ] **Step 3: Typecheck and lint**

Run: `npx tsc --noEmit`
Expected: no errors.
Run: `npm run lint`
Expected: no errors.

- [ ] **Step 4: Manual verification**

In `ui/src/dev/sampleWorkflows.ts`, temporarily set every node's `position` to `{ x: 0, y: 0 }` for
one sample (or add a new degenerate sample and select it in `ui/src/dev/App.tsx`). Run `npm run dev`;
confirm the editor opens with a laid-out graph (not a pile) and that the `onChange` handler in the dev
app receives the workflow with non-degenerate positions (log it if needed). Revert the temporary
sample edit afterward.

- [ ] **Step 5: Commit**

```bash
git add ui/src/components/WorkflowEditor.tsx
git commit -m "feat(ui): auto-layout fallback on load in WorkflowEditor"
```

---

### Task 4: Viewer fallback on render

**Files:**
- Modify: `ui/src/components/WorkflowViewer.tsx`

**Interfaces:**
- Consumes: `needsLayout`, `layoutWorkflow` from `../layout/layoutWorkflow.ts`; existing `nodes`
  `useMemo` and `toReactFlowNodes`.
- Produces: display-only laid-out nodes when `workflow.nodes` is degenerate. No persistence, no new
  exports.

- [ ] **Step 1: Add the import**

At the top of `ui/src/components/WorkflowViewer.tsx`:
```ts
import { needsLayout, layoutWorkflow } from '../layout/layoutWorkflow.ts';
```

- [ ] **Step 2: Lay out inside the existing `nodes` memo**

In `WorkflowViewerInner`, change the start of the `nodes` `useMemo` (currently
`return toReactFlowNodes(workflow.nodes).map(...)`) to lay out first when needed:
```ts
const nodes = useMemo(() => {
  const sourceNodes = needsLayout(workflow.nodes)
    ? layoutWorkflow(workflow.nodes, workflow.edges)
    : workflow.nodes;
  return toReactFlowNodes(sourceNodes).map(node => {
    // ...existing per-node styling logic unchanged...
  });
}, [workflow.nodes, workflow.edges, instance.currentNodeId, instance.status, isTerminal, visitedNodeIds]);
```
Keep the existing per-node body exactly as-is; only the source array and the `workflow.edges`
dependency are added.

- [ ] **Step 3: Typecheck and lint**

Run: `npx tsc --noEmit`
Expected: no errors.
Run: `npm run lint`
Expected: no errors.

- [ ] **Step 4: Manual verification**

Point the dev app's viewer at a degenerate-position workflow (reuse the temporary sample from Task 3,
or set positions to `{0,0}`). Run `npm run dev`, open the viewer, confirm the graph renders laid-out
and framed rather than piled at the origin. Revert any temporary sample edit afterward.

- [ ] **Step 5: Commit**

```bash
git add ui/src/components/WorkflowViewer.tsx
git commit -m "feat(ui): auto-layout fallback on render in WorkflowViewer"
```

---

## Self-Review Notes

- **Spec coverage:** Core engine + `needsLayout` (Task 1) → spec §Architecture/core engine and
  degeneracy detection; manual button (Task 2) → integration (a); editor fallback + persistence
  (Task 3) → integration (b); viewer fallback (Task 4) → integration (c); dagre dependency (Task 1
  Step 1) → spec §Dependencies; LR default and no-mutation → Global Constraints. All spec sections map
  to a task.
- **Placeholders:** none — all code and test bodies are concrete.
- **Type consistency:** `layoutWorkflow` / `needsLayout` / `LayoutOptions` / `NODE_DIMENSIONS`
  signatures are identical across Task 1's Interfaces block, its implementation, and the call sites in
  Tasks 2–4.
- **Testing note:** Components are not unit-tested (project has no jsdom/testing-library; pure logic
  is tested instead). Tasks 2–4 verify via `tsc`, `lint`, and manual dev-app checks, consistent with
  the repo's convention. The algorithm itself is fully covered by Task 1.
