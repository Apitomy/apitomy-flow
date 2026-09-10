# Workflow Visual Diff Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended)
> or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`)
> syntax for tracking.

**Goal:** Add an exported `WorkflowDiffViewer` that visually compares two workflow definitions and clearly
separates semantic changes from cosmetic-only changes.

**Architecture:** Keep comparison logic in pure TypeScript utilities under `ui/src/diff/` and keep rendering
concerns in a new `WorkflowDiffViewer` React component. The viewer consumes a typed `WorkflowDiffResult`,
renders the union graph with status styles, and shows summary, legend, warnings, and before/after details.
The compare contract is explicit (`baseWorkflow` + `compareWorkflow`) and version labels are surfaced in the
header as `name (vN)` when available.

**Tech Stack:** TypeScript, React 19, `@xyflow/react` (React Flow v12), Vite, vitest, ESLint.

**Spec:** `docs/superpowers/specs/2026-09-10-workflow-visual-diff-design.md`

## Global Constraints

- All commands run from the `ui/` directory.
- Verification gates for behavior changes: `npx vitest run` and `npx tsc --noEmit`.
- Follow existing code style and indentation in touched files (this codebase uses 2-space indentation in
  TypeScript/TSX under `ui/src`).
- Node identity is ID-only (`node.id`); changed node IDs are remove+add.
- Position-only node changes are cosmetic-only, not semantic.
- Edge `priority` changes are semantic and must be reported as changed.
- Array ordering differences in `nodes`/`edges` lists are ignored.
- `version` remains optional; the diff UI must surface `vN` when present and fall back to `name`, then `id`.

---

### Task 1: Build the pure workflow diff engine

**Files:**
- Create: `ui/src/diff/workflowDiffTypes.ts`
- Create: `ui/src/diff/workflowDiff.ts`
- Create: `ui/src/diff/workflowDiff.test.ts`

**Interfaces:**
- Consumes: `Workflow`, `WorkflowNode`, `WorkflowEdge` from `../types/workflow.ts`.
- Produces:
  - `export type DiffStatus = 'added' | 'removed' | 'changed' | 'cosmetic' | 'unchanged';`
  - `export interface WorkflowDiffResult { ... }` with node/edge records, summary counts, and warnings.
  - `export function diffWorkflows(baseWorkflow: Workflow, compareWorkflow: Workflow): WorkflowDiffResult`
  - `export function resolveWorkflowLabel(workflow: Pick<Workflow, 'id' | 'name' | 'version'>): string`

- [ ] **Step 1: Write failing tests for the diff contract**

Create `ui/src/diff/workflowDiff.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { diffWorkflows, resolveWorkflowLabel } from './workflowDiff.ts';
import { type Workflow } from '../types/workflow.ts';

function wf(overrides: Partial<Workflow> = {}): Workflow {
  return {
    id: 'wf-1',
    name: 'Example Workflow',
    version: 1,
    nodes: [
      {
        id: 'start',
        type: 'start',
        name: 'Start',
        config: {},
        position: { x: 50, y: 50 },
      },
      {
        id: 'action-a',
        type: 'action',
        name: 'Action A',
        config: { actionType: 'send-email' },
        position: { x: 250, y: 50 },
      },
    ],
    edges: [
      {
        id: 'e1',
        source: 'start',
        target: 'action-a',
        condition: undefined,
        priority: 0,
        isDefault: true,
        label: 'default',
      },
    ],
    ...overrides,
  };
}

describe('diffWorkflows', () => {
  it('marks identical workflows as unchanged', () => {
    const base = wf();
    const compare = wf();
    const result = diffWorkflows(base, compare);

    expect(result.summary.nodes.unchanged).toBe(2);
    expect(result.summary.edges.unchanged).toBe(1);
    expect(result.warnings).toEqual([]);
  });

  it('marks position-only node edits as cosmetic', () => {
    const base = wf();
    const compare = wf({
      nodes: [
        base.nodes[0],
        { ...base.nodes[1], position: { x: 999, y: 777 } },
      ],
    });

    const result = diffWorkflows(base, compare);
    expect(result.nodes['action-a'].status).toBe('cosmetic');
    expect(result.nodes['action-a'].changes).toEqual(['position']);
  });

  it('marks node semantic changes as changed', () => {
    const base = wf();
    const compare = wf({
      nodes: [
        base.nodes[0],
        {
          ...base.nodes[1],
          name: 'Action A updated',
          config: { actionType: 'http-request' },
        },
      ],
    });

    const result = diffWorkflows(base, compare);
    expect(result.nodes['action-a'].status).toBe('changed');
    expect(result.nodes['action-a'].changes).toContain('name');
    expect(result.nodes['action-a'].changes).toContain('config');
  });

  it('marks priority-only edge edits as semantic changes', () => {
    const base = wf();
    const compare = wf({
      edges: [{ ...base.edges[0], priority: 42 }],
    });

    const result = diffWorkflows(base, compare);
    expect(result.edges.e1.status).toBe('changed');
    expect(result.edges.e1.changes).toEqual(['priority']);
  });

  it('ignores array ordering noise', () => {
    const base = wf();
    const compare = wf({
      nodes: [...base.nodes].reverse(),
      edges: [...base.edges].reverse(),
    });

    const result = diffWorkflows(base, compare);
    expect(result.summary.nodes.changed).toBe(0);
    expect(result.summary.nodes.cosmetic).toBe(0);
    expect(result.summary.edges.changed).toBe(0);
  });

  it('emits warnings for duplicate ids', () => {
    const base = wf({
      nodes: [
        {
          id: 'dup',
          type: 'start',
          name: 'A',
          config: {},
          position: { x: 0, y: 0 },
        },
        {
          id: 'dup',
          type: 'action',
          name: 'B',
          config: {},
          position: { x: 100, y: 0 },
        },
      ],
      edges: [],
    });

    const compare = wf({ nodes: [], edges: [] });
    const result = diffWorkflows(base, compare);

    expect(result.warnings.some((warning) => warning.code === 'DUPLICATE_NODE_ID')).toBe(true);
  });
});

describe('resolveWorkflowLabel', () => {
  it('formats name and version when present', () => {
    expect(resolveWorkflowLabel({ id: 'id-1', name: 'Flow', version: 7 })).toBe('Flow (v7)');
  });

  it('falls back to name then id', () => {
    expect(resolveWorkflowLabel({ id: 'id-2', name: 'Flow 2', version: undefined })).toBe('Flow 2');
    expect(resolveWorkflowLabel({ id: 'id-3', name: '', version: undefined })).toBe('id-3');
  });
});
```

- [ ] **Step 2: Run the test file and confirm failure**

Run: `npx vitest run src/diff/workflowDiff.test.ts`
Expected: FAIL with module not found / missing exports.

- [ ] **Step 3: Implement the types and diff engine minimally**

Create `ui/src/diff/workflowDiffTypes.ts`:

```typescript
import { type WorkflowEdge, type WorkflowNode } from '../types/workflow.ts';

export type DiffStatus = 'added' | 'removed' | 'changed' | 'cosmetic' | 'unchanged';

export interface DiffWarning {
  code: 'DUPLICATE_NODE_ID' | 'DUPLICATE_EDGE_ID';
  message: string;
}

export interface NodeDiffRecord {
  id: string;
  status: DiffStatus;
  baseNode?: WorkflowNode;
  compareNode?: WorkflowNode;
  changes: string[];
}

export interface EdgeDiffRecord {
  id: string;
  status: DiffStatus;
  baseEdge?: WorkflowEdge;
  compareEdge?: WorkflowEdge;
  changes: string[];
}

export interface DiffSummaryBucket {
  added: number;
  removed: number;
  changed: number;
  cosmetic: number;
  unchanged: number;
}

export interface WorkflowDiffResult {
  nodeOrder: string[];
  edgeOrder: string[];
  nodes: Record<string, NodeDiffRecord>;
  edges: Record<string, EdgeDiffRecord>;
  summary: {
    nodes: DiffSummaryBucket;
    edges: DiffSummaryBucket;
  };
  warnings: DiffWarning[];
}
```

Create `ui/src/diff/workflowDiff.ts`:

```typescript
import { type Workflow, type WorkflowEdge, type WorkflowNode } from '../types/workflow.ts';
import {
  type DiffStatus,
  type DiffWarning,
  type WorkflowDiffResult,
  type NodeDiffRecord,
  type EdgeDiffRecord,
} from './workflowDiffTypes.ts';

function statusBucket(): WorkflowDiffResult['summary']['nodes'] {
  return { added: 0, removed: 0, changed: 0, cosmetic: 0, unchanged: 0 };
}

function bump(bucket: WorkflowDiffResult['summary']['nodes'], status: DiffStatus): void {
  bucket[status] += 1;
}

function duplicateWarnings(kind: 'node' | 'edge', ids: string[]): DiffWarning[] {
  const code = kind === 'node' ? 'DUPLICATE_NODE_ID' : 'DUPLICATE_EDGE_ID';
  return ids.map((id) => ({
    code,
    message: `Duplicate ${kind} id detected: ${id}. Diff results may be ambiguous.`,
  }));
}

function indexNodes(nodes: WorkflowNode[]): { map: Map<string, WorkflowNode>; duplicates: string[] } {
  const map = new Map<string, WorkflowNode>();
  const duplicates = new Set<string>();
  for (const node of nodes) {
    if (map.has(node.id)) duplicates.add(node.id);
    map.set(node.id, node);
  }
  return { map, duplicates: [...duplicates] };
}

function indexEdges(edges: WorkflowEdge[]): { map: Map<string, WorkflowEdge>; duplicates: string[] } {
  const map = new Map<string, WorkflowEdge>();
  const duplicates = new Set<string>();
  for (const edge of edges) {
    if (map.has(edge.id)) duplicates.add(edge.id);
    map.set(edge.id, edge);
  }
  return { map, duplicates: [...duplicates] };
}

function samePosition(a?: WorkflowNode, b?: WorkflowNode): boolean {
  if (!a || !b) return false;
  return a.position.x === b.position.x && a.position.y === b.position.y;
}

function nodeDiff(baseNode?: WorkflowNode, compareNode?: WorkflowNode): NodeDiffRecord {
  if (!baseNode && compareNode) return { id: compareNode.id, status: 'added', compareNode, changes: [] };
  if (baseNode && !compareNode) return { id: baseNode.id, status: 'removed', baseNode, changes: [] };

  const changes: string[] = [];
  if (baseNode!.type !== compareNode!.type) changes.push('type');
  if (baseNode!.name !== compareNode!.name) changes.push('name');
  if (JSON.stringify(baseNode!.config) !== JSON.stringify(compareNode!.config)) changes.push('config');
  if (!samePosition(baseNode, compareNode)) changes.push('position');

  const semanticChanges = changes.filter((field) => field !== 'position');
  const status: DiffStatus = semanticChanges.length > 0
    ? 'changed'
    : changes.length > 0
      ? 'cosmetic'
      : 'unchanged';

  return {
    id: compareNode!.id,
    status,
    baseNode,
    compareNode,
    changes,
  };
}

function edgeDiff(baseEdge?: WorkflowEdge, compareEdge?: WorkflowEdge): EdgeDiffRecord {
  if (!baseEdge && compareEdge) return { id: compareEdge.id, status: 'added', compareEdge, changes: [] };
  if (baseEdge && !compareEdge) return { id: baseEdge.id, status: 'removed', baseEdge, changes: [] };

  const changes: string[] = [];
  if (baseEdge!.source !== compareEdge!.source) changes.push('source');
  if (baseEdge!.target !== compareEdge!.target) changes.push('target');
  if (baseEdge!.condition !== compareEdge!.condition) changes.push('condition');
  if (baseEdge!.priority !== compareEdge!.priority) changes.push('priority');
  if (baseEdge!.isDefault !== compareEdge!.isDefault) changes.push('isDefault');
  if (baseEdge!.label !== compareEdge!.label) changes.push('label');

  const status: DiffStatus = changes.length > 0 ? 'changed' : 'unchanged';
  return {
    id: compareEdge!.id,
    status,
    baseEdge,
    compareEdge,
    changes,
  };
}

/** Compare two workflow definitions and classify node/edge differences. */
export function diffWorkflows(baseWorkflow: Workflow, compareWorkflow: Workflow): WorkflowDiffResult {
  const baseNodes = indexNodes(baseWorkflow.nodes);
  const compareNodes = indexNodes(compareWorkflow.nodes);
  const baseEdges = indexEdges(baseWorkflow.edges);
  const compareEdges = indexEdges(compareWorkflow.edges);

  const warnings: DiffWarning[] = [
    ...duplicateWarnings('node', baseNodes.duplicates),
    ...duplicateWarnings('node', compareNodes.duplicates),
    ...duplicateWarnings('edge', baseEdges.duplicates),
    ...duplicateWarnings('edge', compareEdges.duplicates),
  ];

  const nodeOrder = [...new Set([...baseWorkflow.nodes.map((node) => node.id), ...compareWorkflow.nodes.map(
    (node) => node.id)])];
  const edgeOrder = [...new Set([...baseWorkflow.edges.map((edge) => edge.id), ...compareWorkflow.edges.map(
    (edge) => edge.id)])];

  const nodes: Record<string, NodeDiffRecord> = {};
  const edges: Record<string, EdgeDiffRecord> = {};
  const nodeSummary = statusBucket();
  const edgeSummary = statusBucket();

  for (const id of nodeOrder) {
    const record = nodeDiff(baseNodes.map.get(id), compareNodes.map.get(id));
    nodes[id] = record;
    bump(nodeSummary, record.status);
  }

  for (const id of edgeOrder) {
    const record = edgeDiff(baseEdges.map.get(id), compareEdges.map.get(id));
    edges[id] = record;
    bump(edgeSummary, record.status);
  }

  return {
    nodeOrder,
    edgeOrder,
    nodes,
    edges,
    summary: {
      nodes: nodeSummary,
      edges: edgeSummary,
    },
    warnings,
  };
}

/** Resolve a human-readable workflow label for headers and summaries. */
export function resolveWorkflowLabel(workflow: Pick<Workflow, 'id' | 'name' | 'version'>): string {
  const trimmedName = workflow.name?.trim();
  if (trimmedName && workflow.version !== undefined) {
    return `${trimmedName} (v${workflow.version})`;
  }
  if (trimmedName) return trimmedName;
  return workflow.id;
}
```

- [ ] **Step 4: Run targeted tests and confirm pass**

Run: `npx vitest run src/diff/workflowDiff.test.ts`
Expected: PASS.

- [ ] **Step 5: Run typecheck for new diff module**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 6: Commit Task 1**

```bash
git add src/diff/workflowDiffTypes.ts src/diff/workflowDiff.ts src/diff/workflowDiff.test.ts
git commit -m "Add pure workflow diff engine and tests (#93)"
```

---

### Task 2: Build diff-to-render mapping helpers

**Files:**
- Create: `ui/src/diff/buildDiffRenderModel.ts`
- Create: `ui/src/diff/buildDiffRenderModel.test.ts`

**Interfaces:**
- Consumes: `Workflow`, `WorkflowNode`, `WorkflowEdge`; `WorkflowDiffResult` from Task 1.
- Produces:
  - `export interface DiffRenderModel { nodes: WorkflowNode[]; edges: WorkflowEdge[]; }`
  - `export function buildDiffRenderModel(baseWorkflow: Workflow, compareWorkflow: Workflow,
    diff: WorkflowDiffResult): DiffRenderModel`

- [ ] **Step 1: Write failing tests for render model generation**

Create `ui/src/diff/buildDiffRenderModel.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { type Workflow } from '../types/workflow.ts';
import { diffWorkflows } from './workflowDiff.ts';
import { buildDiffRenderModel } from './buildDiffRenderModel.ts';

function makeWorkflow(nodes: Workflow['nodes'], edges: Workflow['edges']): Workflow {
  return { id: 'wf', name: 'WF', nodes, edges };
}

describe('buildDiffRenderModel', () => {
  it('uses compare position when both versions contain the node', () => {
    const base = makeWorkflow(
      [{ id: 'a', type: 'action', name: 'A', config: {}, position: { x: 1, y: 1 } }],
      [],
    );
    const compare = makeWorkflow(
      [{ id: 'a', type: 'action', name: 'A', config: {}, position: { x: 9, y: 9 } }],
      [],
    );

    const diff = diffWorkflows(base, compare);
    const model = buildDiffRenderModel(base, compare, diff);

    expect(model.nodes[0].position).toEqual({ x: 9, y: 9 });
  });

  it('keeps removed nodes in the render model using base coordinates', () => {
    const base = makeWorkflow(
      [{ id: 'gone', type: 'action', name: 'Gone', config: {}, position: { x: 4, y: 2 } }],
      [],
    );
    const compare = makeWorkflow([], []);

    const diff = diffWorkflows(base, compare);
    const model = buildDiffRenderModel(base, compare, diff);

    expect(model.nodes.map((node) => node.id)).toContain('gone');
    expect(model.nodes.find((node) => node.id === 'gone')?.position).toEqual({ x: 4, y: 2 });
  });

  it('includes union of edges by id', () => {
    const base = makeWorkflow(
      [{ id: 'a', type: 'start', name: 'A', config: {}, position: { x: 0, y: 0 } }],
      [{ id: 'e-removed', source: 'a', target: 'a', priority: 0, isDefault: true }],
    );
    const compare = makeWorkflow(
      [{ id: 'a', type: 'start', name: 'A', config: {}, position: { x: 0, y: 0 } }],
      [{ id: 'e-added', source: 'a', target: 'a', priority: 1, isDefault: false }],
    );

    const diff = diffWorkflows(base, compare);
    const model = buildDiffRenderModel(base, compare, diff);

    expect(model.edges.map((edge) => edge.id)).toEqual(expect.arrayContaining(['e-removed', 'e-added']));
  });
});
```

- [ ] **Step 2: Run the test file and confirm failure**

Run: `npx vitest run src/diff/buildDiffRenderModel.test.ts`
Expected: FAIL with missing module/export.

- [ ] **Step 3: Implement the render model helper minimally**

Create `ui/src/diff/buildDiffRenderModel.ts`:

```typescript
import { type Workflow, type WorkflowEdge, type WorkflowNode } from '../types/workflow.ts';
import { type WorkflowDiffResult } from './workflowDiffTypes.ts';

export interface DiffRenderModel {
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
}

function preferredNode(baseNode?: WorkflowNode, compareNode?: WorkflowNode): WorkflowNode | undefined {
  if (compareNode && baseNode) return { ...compareNode, position: compareNode.position ?? baseNode.position };
  return compareNode ?? baseNode;
}

function preferredEdge(baseEdge?: WorkflowEdge, compareEdge?: WorkflowEdge): WorkflowEdge | undefined {
  return compareEdge ?? baseEdge;
}

/**
 * Build a render model for the diff graph from the union of node/edge ids.
 */
export function buildDiffRenderModel(
  baseWorkflow: Workflow,
  compareWorkflow: Workflow,
  diff: WorkflowDiffResult,
): DiffRenderModel {
  const baseNodeMap = new Map(baseWorkflow.nodes.map((node) => [node.id, node]));
  const compareNodeMap = new Map(compareWorkflow.nodes.map((node) => [node.id, node]));
  const baseEdgeMap = new Map(baseWorkflow.edges.map((edge) => [edge.id, edge]));
  const compareEdgeMap = new Map(compareWorkflow.edges.map((edge) => [edge.id, edge]));

  const nodes: WorkflowNode[] = diff.nodeOrder
    .map((id) => preferredNode(baseNodeMap.get(id), compareNodeMap.get(id)))
    .filter((node): node is WorkflowNode => !!node);

  const edges: WorkflowEdge[] = diff.edgeOrder
    .map((id) => preferredEdge(baseEdgeMap.get(id), compareEdgeMap.get(id)))
    .filter((edge): edge is WorkflowEdge => !!edge);

  return { nodes, edges };
}
```

- [ ] **Step 4: Run targeted tests and confirm pass**

Run: `npx vitest run src/diff/buildDiffRenderModel.test.ts`
Expected: PASS.

- [ ] **Step 5: Run typecheck to validate interfaces between Task 1 and Task 2**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 6: Commit Task 2**

```bash
git add src/diff/buildDiffRenderModel.ts src/diff/buildDiffRenderModel.test.ts
git commit -m "Add diff render-model mapping helpers (#93)"
```

---

### Task 3: Implement `WorkflowDiffViewer` and styles

**Files:**
- Create: `ui/src/components/WorkflowDiffViewer.tsx`
- Create: `ui/src/components/WorkflowDiffViewer.css`
- Modify: `ui/src/index.ts`

**Interfaces:**
- Consumes:
  - `nodeTypes` from `./nodes/nodeTypes.ts`
  - `edgeTypes` from `./edges/edgeTypes.ts`
  - `toReactFlowNodes`, `toReactFlowEdges` from `../utils/conversion.ts`
  - `needsLayout`, `layoutWorkflow` from `../layout/layoutWorkflow.ts`
  - `diffWorkflows`, `resolveWorkflowLabel` from `../diff/workflowDiff.ts`
  - `buildDiffRenderModel` from `../diff/buildDiffRenderModel.ts`
- Produces:
  - `export interface WorkflowDiffViewerProps { baseWorkflow: Workflow; compareWorkflow: Workflow;
    theme?: FlowTheme; }`
  - `export function WorkflowDiffViewer(props: WorkflowDiffViewerProps): JSX.Element`
  - new library exports in `src/index.ts`

- [ ] **Step 1: Add a failing API-surface test for library exports**

Create `ui/src/dev/libraryExports.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import * as library from '../index.ts';

describe('library exports', () => {
  it('exports WorkflowDiffViewer', () => {
    expect(library.WorkflowDiffViewer).toBeTypeOf('function');
  });
});
```

- [ ] **Step 2: Run targeted tests and confirm failure**

Run: `npx vitest run src/dev/libraryExports.test.ts`
Expected: FAIL because `WorkflowDiffViewer` is not exported yet.

- [ ] **Step 3: Implement the component and CSS minimally**

Create `ui/src/components/WorkflowDiffViewer.tsx` using this structure:

```tsx
import { useMemo, useState, useCallback } from 'react';
import { ReactFlow, Background, Controls, ReactFlowProvider, type Node, type Edge } from '@xyflow/react';
import { type Workflow } from '../types/workflow.ts';
import { type FlowTheme } from './WorkflowEditor.tsx';
import { nodeTypes } from './nodes/nodeTypes.ts';
import { edgeTypes } from './edges/edgeTypes.ts';
import { toReactFlowNodes, toReactFlowEdges } from '../utils/conversion.ts';
import { needsLayout, layoutWorkflow } from '../layout/layoutWorkflow.ts';
import { diffWorkflows, resolveWorkflowLabel } from '../diff/workflowDiff.ts';
import { buildDiffRenderModel } from '../diff/buildDiffRenderModel.ts';
import { type DiffStatus } from '../diff/workflowDiffTypes.ts';
import './theme.css';
import './WorkflowDiffViewer.css';

export interface WorkflowDiffViewerProps {
  baseWorkflow: Workflow;
  compareWorkflow: Workflow;
  theme?: FlowTheme;
}

function WorkflowDiffViewerInner({ baseWorkflow, compareWorkflow, theme = 'light' }: WorkflowDiffViewerProps) {
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);

  const diff = useMemo(() => diffWorkflows(baseWorkflow, compareWorkflow), [baseWorkflow, compareWorkflow]);

  const model = useMemo(
    () => buildDiffRenderModel(baseWorkflow, compareWorkflow, diff),
    [baseWorkflow, compareWorkflow, diff],
  );

  const laidOutNodes = useMemo(
    () => (needsLayout(model.nodes) ? layoutWorkflow(model.nodes, model.edges) : model.nodes),
    [model.nodes, model.edges],
  );

  const nodes = useMemo(
    () => toReactFlowNodes(laidOutNodes).map((node) => ({
      ...node,
      className: `flow-diff-node flow-diff-node--${diff.nodes[node.id]?.status ?? 'unchanged'}`,
      draggable: false,
    })),
    [laidOutNodes, diff.nodes],
  );

  const edges = useMemo(
    () => toReactFlowEdges(model.edges).map((edge) => ({
      ...edge,
      className: `flow-diff-edge flow-diff-edge--${diff.edges[edge.id]?.status ?? 'unchanged'}`,
      style: {
        ...(edge.style ?? {}),
        opacity: diff.edges[edge.id]?.status === 'removed' ? 0.45 : 1,
      },
      animated: false,
    })),
    [model.edges, diff.edges],
  );

  const onNodeClick = useCallback((_: unknown, node: Node) => {
    setSelectedEdgeId(null);
    setSelectedNodeId(node.id);
  }, []);

  const onEdgeClick = useCallback((_: unknown, edge: Edge) => {
    setSelectedNodeId(null);
    setSelectedEdgeId(edge.id);
  }, []);

  const selectedNodeDiff = selectedNodeId ? diff.nodes[selectedNodeId] : undefined;
  const selectedEdgeDiff = selectedEdgeId ? diff.edges[selectedEdgeId] : undefined;
  const baseLabel = resolveWorkflowLabel(baseWorkflow);
  const compareLabel = resolveWorkflowLabel(compareWorkflow);

  return (
    <div className="workflow-diff-viewer" data-flow-theme={theme}>
      <div className="workflow-diff-viewer__main">
        <div className="workflow-diff-viewer__header">
          <div>{baseLabel} -> {compareLabel}</div>
          <div className="workflow-diff-viewer__summary">
            Nodes: +{diff.summary.nodes.added} -{diff.summary.nodes.removed} ~{diff.summary.nodes.changed}
            | cosmetic {diff.summary.nodes.cosmetic}
          </div>
        </div>
        {diff.warnings.length > 0 && (
          <div className="workflow-diff-viewer__warnings">
            {diff.warnings.map((warning) => (
              <div key={`${warning.code}-${warning.message}`}>{warning.message}</div>
            ))}
          </div>
        )}
        <div className="workflow-diff-viewer__canvas">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            nodesDraggable={false}
            nodesConnectable={false}
            colorMode={theme}
            onNodeClick={onNodeClick}
            onEdgeClick={onEdgeClick}
            fitView
          >
            <Background />
            <Controls showInteractive={false} />
          </ReactFlow>
        </div>
      </div>
      <div className="workflow-diff-viewer__detail">
        {selectedNodeDiff && <DiffDetail kind="Node" id={selectedNodeDiff.id} status={selectedNodeDiff.status}
          changes={selectedNodeDiff.changes} />}
        {selectedEdgeDiff && <DiffDetail kind="Edge" id={selectedEdgeDiff.id} status={selectedEdgeDiff.status}
          changes={selectedEdgeDiff.changes} />}
        {!selectedNodeDiff && !selectedEdgeDiff && (
          <div className="workflow-diff-viewer__empty">Select a node or edge to inspect changes.</div>
        )}
      </div>
    </div>
  );
}

function DiffDetail(props: { kind: 'Node' | 'Edge'; id: string; status: DiffStatus; changes: string[] }) {
  return (
    <div>
      <div className="workflow-diff-viewer__detail-title">{props.kind} {props.id}</div>
      <div className={`workflow-diff-viewer__status workflow-diff-viewer__status--${props.status}`}>
        {props.status}
      </div>
      {props.changes.length > 0 ? (
        <ul className="workflow-diff-viewer__changes">
          {props.changes.map((change) => <li key={change}>{change}</li>)}
        </ul>
      ) : (
        <div className="workflow-diff-viewer__empty">No field-level changes.</div>
      )}
    </div>
  );
}

export function WorkflowDiffViewer(props: WorkflowDiffViewerProps) {
  return (
    <ReactFlowProvider>
      <WorkflowDiffViewerInner {...props} />
    </ReactFlowProvider>
  );
}
```

Create `ui/src/components/WorkflowDiffViewer.css` with initial status styles:

```css
.workflow-diff-viewer {
  height: 100%;
  width: 100%;
  display: grid;
  grid-template-columns: 1fr 320px;
  color: var(--flow-text, #151515);
}

.workflow-diff-viewer__main {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.workflow-diff-viewer__header {
  padding: 10px 12px;
  border-bottom: 1px solid var(--flow-border, #d2d2d2);
  background: var(--flow-bg-primary, #fff);
  font-size: 13px;
  font-weight: 600;
}

.workflow-diff-viewer__summary {
  margin-top: 4px;
  font-size: 12px;
  color: var(--flow-text-subtle, #6a6e73);
  font-weight: 500;
}

.workflow-diff-viewer__warnings {
  padding: 8px 12px;
  border-bottom: 1px solid var(--flow-border, #d2d2d2);
  background: var(--flow-status-waiting-bg, #fff3e0);
  color: var(--flow-status-waiting-text, #5c3000);
  font-size: 12px;
}

.workflow-diff-viewer__canvas {
  flex: 1;
}

.flow-diff-node--added { opacity: 1; }
.flow-diff-node--removed { opacity: 0.5; }
.flow-diff-node--unchanged { opacity: 0.45; }
.flow-diff-node--cosmetic { opacity: 0.85; }
.flow-diff-node--changed { opacity: 1; }

.flow-diff-edge--added .react-flow__edge-path { stroke: var(--flow-status-success, #3e8635); stroke-width: 2.5; }
.flow-diff-edge--removed .react-flow__edge-path { stroke: var(--flow-status-danger, #c9190b); stroke-dasharray: 5 3; }
.flow-diff-edge--changed .react-flow__edge-path { stroke: var(--flow-brand, #06c); stroke-width: 2.5; }
.flow-diff-edge--unchanged .react-flow__edge-path { opacity: 0.35; }

.workflow-diff-viewer__detail {
  border-left: 1px solid var(--flow-border, #d2d2d2);
  background: var(--flow-bg-primary, #fff);
  padding: 12px;
  overflow: auto;
}

.workflow-diff-viewer__detail-title {
  font-size: 14px;
  font-weight: 700;
  margin-bottom: 8px;
}

.workflow-diff-viewer__status {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 12px;
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  margin-bottom: 8px;
}

.workflow-diff-viewer__status--added {
  background: var(--flow-status-completed-bg, #e6f5e4);
  color: var(--flow-status-completed-text, #1e4620);
}

.workflow-diff-viewer__status--removed {
  background: var(--flow-status-failed-bg, #fce4e4);
  color: var(--flow-status-failed-text, #7d1007);
}

.workflow-diff-viewer__status--changed,
.workflow-diff-viewer__status--cosmetic,
.workflow-diff-viewer__status--unchanged {
  background: var(--flow-bg-secondary, #f0f0f0);
  color: var(--flow-text-subtle, #6a6e73);
}

.workflow-diff-viewer__changes {
  margin: 0;
  padding-left: 18px;
  font-size: 12px;
}

.workflow-diff-viewer__empty {
  font-size: 12px;
  color: var(--flow-text-subtle, #6a6e73);
}
```

Update `ui/src/index.ts`:

```typescript
export { WorkflowDiffViewer, type WorkflowDiffViewerProps } from './components/WorkflowDiffViewer.tsx';
export type {
  DiffStatus,
  DiffWarning,
  NodeDiffRecord,
  EdgeDiffRecord,
  DiffSummaryBucket,
  WorkflowDiffResult,
} from './diff/workflowDiffTypes.ts';
```

- [ ] **Step 4: Run the export test and confirm pass**

Run: `npx vitest run src/dev/libraryExports.test.ts`
Expected: PASS.

- [ ] **Step 5: Run full tests and typecheck**

Run: `npx vitest run && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 6: Commit Task 3**

```bash
git add src/components/WorkflowDiffViewer.tsx src/components/WorkflowDiffViewer.css src/index.ts \
  src/dev/libraryExports.test.ts
git commit -m "Add WorkflowDiffViewer component and library exports (#93)"
```

---

### Task 4: Add dev-surface usage sample and polish details panel semantics

**Files:**
- Modify: `ui/src/dev/App.tsx`
- Modify: `ui/src/dev/navigationModel.ts`
- Modify: `ui/src/dev/layoutModel.ts` (if needed for new nav section behavior)
- Modify: `ui/src/dev/sampleWorkflows.ts`
- Create: `ui/src/dev/workflowDiffScenarios.ts` (optional if this keeps `sampleWorkflows.ts` focused)
- Test: `ui/src/dev/navigationModel.test.ts` and/or `ui/src/dev/layoutModel.test.ts` as needed

**Interfaces:**
- Consumes: `WorkflowDiffViewer` export and existing demo scenario model.
- Produces: a usable demo route so developers can manually verify visual diff behavior during `npm run dev`.

- [ ] **Step 1: Add a failing test for demo navigation model (new diff tab)**

Update `ui/src/dev/navigationModel.test.ts` with one new assertion:

```typescript
it('includes diff view in demo navigation', () => {
  expect(demoNavItems.some((item) => item.key === 'diff')).toBe(true);
});
```

- [ ] **Step 2: Run the targeted test and confirm failure**

Run: `npx vitest run src/dev/navigationModel.test.ts`
Expected: FAIL because `diff` tab is not present.

- [ ] **Step 3: Implement dev app wiring for diff scenarios**

Implementation checklist:

```typescript
// navigationModel.ts
export type DemoNavKey = 'editor' | 'viewer' | 'diff';
// add { key: 'diff', label: 'Diff viewer' }

// App.tsx
// import WorkflowDiffViewer and two scenarios for base/compare
// render <WorkflowDiffViewer baseWorkflow={...} compareWorkflow={...} theme={theme} /> when activeView==='diff'

// sampleWorkflows.ts (or workflowDiffScenarios.ts)
// provide at least one pair with semantic + cosmetic changes and one with add/remove changes
```

- [ ] **Step 4: Re-run targeted test and confirm pass**

Run: `npx vitest run src/dev/navigationModel.test.ts`
Expected: PASS.

- [ ] **Step 5: Run full tests and typecheck**

Run: `npx vitest run && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 6: Commit Task 4**

```bash
git add src/dev/App.tsx src/dev/navigationModel.ts src/dev/layoutModel.ts src/dev/sampleWorkflows.ts \
  src/dev/navigationModel.test.ts
git commit -m "Add demo route and scenarios for WorkflowDiffViewer (#93)"
```

---

## Self-Review

**Spec coverage:**
- Visual diff component comparing two explicit definitions (`baseWorkflow`, `compareWorkflow`) is covered by
  Task 3. ✅
- Semantic vs cosmetic distinction is implemented and tested in Task 1. ✅
- Array ordering ignored and edge priority semantic behavior are tested in Task 1. ✅
- Version label surfacing (`name (vN)` fallback behavior) is implemented/tested in Task 1 and displayed in
  Task 3 header. ✅
- Warning metadata for duplicate IDs is implemented in Task 1 and surfaced in Task 3 warning banner. ✅
- Existing viewer/editor concerns remain separated because this is a new component, not a mode. ✅

**Placeholder scan:**
- No `TBD`, `TODO`, or "implement later" markers in task steps.
- Each code-writing step contains concrete code or explicit implementation checklist lines. ✅

**Type consistency:**
- `WorkflowDiffResult` from Task 1 is consumed consistently in Task 2 and Task 3.
- `resolveWorkflowLabel()` signature and behavior are consistent between tests and viewer usage.
- Export names in Task 3 (`WorkflowDiffViewer`, `WorkflowDiffViewerProps`, diff types) match introduced
  symbols. ✅
