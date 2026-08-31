# Auto-Layout for Apitomy Flow

**Status:** Approved design
**Date:** 2026-08-31
**Component:** `@apitomy/flow-ui` (`ui/`)

## Summary

Add automatic graph layout to Apitomy Flow so workflows are always readable, whether they were
hand-authored, imported, or machine-generated. A single pure layout function (backed by
[`@dagrejs/dagre`](https://github.com/dagrejs/dagre)) computes node positions for a directed
workflow graph. It is used in three places:

1. A manual **"Tidy up"** button in the `WorkflowEditor` toolbar.
2. An **editor fallback** that lays out and persists positions when a workflow loads with degenerate
   coordinates.
3. A **viewer fallback** that lays out for display when `WorkflowViewer` receives a workflow with
   degenerate coordinates.

## Motivation

- **Positions are first-class and persisted.** Every `WorkflowNode` carries `{ x, y }`
  (`ui/src/types/workflow.ts`). A workflow that arrives without meaningful coordinates (AI-generated,
  imported, or hand-written JSON) renders as an overlapping pile at the origin.
- **The graph is a conditional DAG-ish flow.** Edges carry `priority`, `isDefault`, and optional
  `condition`. This is exactly the shape that layered graph-layout algorithms handle well.
- **The editor already has the right seams.** Undo/redo (`takeSnapshot`), `fitView` from
  `useReactFlow`, and a top-right toolbar `Panel` are all present, so a snapshot-able, undoable
  layout action drops in cleanly.

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Library | `@dagrejs/dagre` (runtime dependency) | Small, synchronous, battle-tested layered layout; the maintained fork bundles its own TS types. Ships to consumers, so it belongs in `dependencies`. |
| Default direction | Left-to-right (`LR`) | Chosen for this project. A `direction` option exists in the API but is not surfaced in the UI. |
| Fallback trigger | Degenerate positions | Preserve intentionally hand-placed layouts; only rescue graphs that need it. |
| Editor fallback persistence | Persist via `onChange` | Next load has real coordinates and layout runs once; the laid-out state becomes the first undo snapshot. |
| Node sizing | Per-node-type constants, with optional caller override | Keeps the core function pure and deterministic; node CSS is fixed-size per type. |

## Architecture

### Core engine — `ui/src/layout/layoutWorkflow.ts`

A pure module operating on the domain types (`WorkflowNode` / `WorkflowEdge`), never on React Flow
objects, so it is trivially unit-testable and matches the project's "keep testable logic pure"
convention.

```ts
export interface LayoutOptions {
  direction?: 'LR' | 'TB';        // default 'LR'
  nodeSpacing?: number;           // gap between siblings (dagre nodesep)
  rankSpacing?: number;           // gap between ranks (dagre ranksep)
  nodeSize?: (node: WorkflowNode) => { width: number; height: number };
}

// Returns a NEW node array with updated positions; never mutates input.
export function layoutWorkflow(
  nodes: WorkflowNode[],
  edges: WorkflowEdge[],
  options?: LayoutOptions,
): WorkflowNode[];

// True when positions are degenerate and the graph should be auto-laid-out.
export function needsLayout(nodes: WorkflowNode[]): boolean;
```

**`layoutWorkflow` internals:**

- Build a dagre graph with `rankdir` from `direction` (default `LR`), `nodesep` / `ranksep` from the
  spacing options.
- Add each node with a width/height. Sizing defaults to a per-node-type `NODE_DIMENSIONS` map;
  callers that have React Flow's measured dimensions can pass `nodeSize` to override.
- Add each edge (`source` -> `target`).
- **Cycles:** set `acyclicer: 'greedy'` so loop-back edges (e.g. wait / receive-event retries) do not
  break or hang the layout.
- dagre returns node *centers*; convert to React Flow's top-left origin (`x - width / 2`,
  `y - height / 2`).
- Return a new node array; do not mutate the input.

**`needsLayout` heuristic:** returns `true` when any node is missing a position, **or** when all nodes
share effectively the same coordinate (every node within ~1px of the others, e.g. all at the origin).
A graph with distinct, spread-out coordinates is treated as intentionally placed and left untouched.

### Integration points

**a) Editor manual "Tidy up" button** — added to the existing top-right toolbar `Panel` in
`WorkflowEditor.tsx` (alongside Undo/Redo). On click:

1. `takeSnapshot(nodes, edges)` so the action is undoable.
2. Run `layoutWorkflow` on the current nodes (passing measured dimensions when available).
3. `setNodes` with the result and set `changeNeededRef` so `onChange` fires.
4. `fitView` to reframe.

**b) Editor fallback on load** — in the mount/initialization path, if `needsLayout(workflow.nodes)`
is true, compute the layout for `initialNodes`, use it as the initial state, and emit `onChange` once
so the host persists real coordinates. Guarded to run a single time; the first undo snapshot captures
the laid-out state.

**c) Viewer fallback on render** — in `WorkflowViewer.tsx`, when `needsLayout(workflow.nodes)` is
true, run `layoutWorkflow` inside the existing `useMemo` before mapping to React Flow nodes. This is
display-only (the viewer never persists), and the existing `fitView` frames the result.

**Node dimensions note:** for cases (a) and (b), measured dimensions may not exist before first
paint, so they rely on the constant `NODE_DIMENSIONS` map. This is consistent and simple; the manual
button (running post-render) may pass measured dimensions for extra precision, but constants
everywhere is an acceptable baseline.

## Dependencies

- Add `@dagrejs/dagre` to `dependencies` in `ui/package.json`.

## Testing

Following the project's convention (pure logic, vitest, no jsdom):

- `ui/src/layout/layoutWorkflow.test.ts`:
  - **`layoutWorkflow`**: start node is leftmost in `LR`; no node overlaps; a graph containing a
    cycle completes without hanging; empty graph and single-node graph are handled; input is not
    mutated.
  - **`needsLayout`**: true when a position is missing; true when all nodes are at the origin / share
    a coordinate; false for a spread-out, intentionally-placed graph.
- Run `npx vitest run` for the affected tests and `npx tsc --noEmit` to confirm the change compiles,
  per the project's testing expectations for AI agents.

## Out of Scope (YAGNI)

- No configurable-direction UI control (LR is fixed in the UI; the API option exists but is not
  surfaced).
- No per-node manual pinning / "keep this node where it is".
- No `elkjs`, no custom edge routing.
- No animated transition when re-laying-out.
