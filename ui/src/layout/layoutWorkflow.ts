import dagre from '@dagrejs/dagre';
import { type WorkflowNode, type WorkflowEdge, type NodeType, type Workflow } from '../types/workflow.ts';

export const DEFAULT_NODE_DIMENSION = { width: 180, height: 50 };

/**
 * Approximate rendered size (px) of each node type, used only to space the
 * dagre layout. These mirror the node component CSS (see
 * `../components/nodes/*.css`); if a node's CSS size changes materially, update
 * the matching entry here so layouts stay well-spaced. Slight drift only affects
 * spacing, never correctness. Callers with measured dimensions can override via
 * `LayoutOptions.nodeSize`.
 */
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
 * @throws when the layout engine fails or returns nonfinite coordinates
 */
export function layoutWorkflow(
  nodes: WorkflowNode[],
  edges: WorkflowEdge[],
  options?: LayoutOptions,
): (WorkflowNode & { position: { x: number; y: number } })[] {
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
  // Dagre uses object-keyed internals. Never expose wire IDs such as __proto__ or constructor to it.
  const layoutIds = new Map(nodes.map((node, index) => [node.id, `layout-${index}`]));
  for (const node of nodes) {
    const size = sizeOf(node, options);
    dims.set(node.id, size);
    g.setNode(layoutIds.get(node.id)!, { width: size.width, height: size.height });
  }

  // Reverse loop-back edges ourselves (rather than letting dagre guess) so ranks follow the
  // flow from the start node(s): a loop's target always stays left of its source.
  const backEdges = findBackEdges(nodes, edges);
  for (const edge of edges) {
    const source = layoutIds.get(edge.source);
    const target = layoutIds.get(edge.target);
    if (source === undefined || target === undefined || source === target) continue;
    if (backEdges.has(edge)) {
      g.setEdge(target, source);
    } else {
      g.setEdge(source, target);
    }
  }

  dagre.layout(g);

  return nodes.map(node => {
    const laidOut = g.node(layoutIds.get(node.id)!);
    const size = dims.get(node.id) ?? DEFAULT_NODE_DIMENSION;
    // dagre returns node centers; React Flow positions are top-left.
    const position = { x: laidOut?.x - size.width / 2, y: laidOut?.y - size.height / 2 };
    if (!Number.isFinite(position.x) || !Number.isFinite(position.y)) {
      throw new Error(`Layout did not produce finite coordinates for node ${node.id}`);
    }
    return {
      ...node,
      position,
    };
  });
}

/**
 * Identify loop-back edges: edges that point to a node still on the depth-first search stack
 * when the graph is walked from its start node(s) along edges in priority order. Removing
 * (or reversing) these edges leaves an acyclic graph whose order matches the execution flow.
 * Nodes unreachable from a start node are walked afterwards, in document order.
 *
 * @param nodes the workflow nodes
 * @param edges the workflow edges
 * @returns the set of edges that close a cycle
 */
export function findBackEdges(nodes: WorkflowNode[], edges: WorkflowEdge[]): Set<WorkflowEdge> {
  const outgoing = new Map<string, WorkflowEdge[]>();
  for (const edge of edges) {
    const list = outgoing.get(edge.source) ?? [];
    list.push(edge);
    outgoing.set(edge.source, list);
  }
  for (const list of outgoing.values()) {
    list.sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0));
  }

  const back = new Set<WorkflowEdge>();
  const state = new Map<string, 'active' | 'done'>();
  const visit = (root: string): void => {
    // Iterative DFS so very long workflows cannot overflow the call stack.
    const stack: { id: string; next: number }[] = [{ id: root, next: 0 }];
    state.set(root, 'active');
    while (stack.length > 0) {
      const frame = stack[stack.length - 1];
      const out = outgoing.get(frame.id) ?? [];
      if (frame.next >= out.length) {
        state.set(frame.id, 'done');
        stack.pop();
        continue;
      }
      const edge = out[frame.next++];
      const seen = state.get(edge.target);
      if (seen === 'active') {
        back.add(edge);
      } else if (seen === undefined) {
        state.set(edge.target, 'active');
        stack.push({ id: edge.target, next: 0 });
      }
    }
  };

  const roots = [...nodes.filter(n => n.type === 'start'), ...nodes];
  for (const node of roots) {
    if (!state.has(node.id)) visit(node.id);
  }
  return back;
}

/**
 * Decide whether a workflow's node positions are degenerate and should be
 * auto-laid-out. Returns true when any node lacks a valid position, or when
 * two or more nodes all share effectively the same coordinate (e.g. all at the
 * origin). A single node with a valid position, and any graph whose nodes are
 * spread out, are treated as intentionally placed and left untouched.
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

  // With fewer than two valid-position nodes there is nothing to disambiguate,
  // so a lone node with a real position is respected rather than re-laid-out.
  if (nodes.length < 2) return false;

  const first = nodes[0].position!; // All positions were checked above.
  const allSame = nodes.every(n =>
    Math.abs(n.position!.x - first.x) < 1 && Math.abs(n.position!.y - first.y) < 1);
  return allSame;
}

const PLACEMENT_GAP_X = 90;
const PLACEMENT_GAP_Y = 30;
const PLACEMENT_BELOW = 100;

type Point = { x: number; y: number };

function hasPosition(node: WorkflowNode): boolean {
  const p = node.position;
  return !!p && typeof p.x === 'number' && typeof p.y === 'number' && Number.isFinite(p.x) && Number.isFinite(p.y);
}

/**
 * Positions only the nodes that have no valid position, leaving every positioned node untouched.
 *
 * Each new node goes right of its positioned predecessors (or left of its positioned successors) at their
 * average height, else below the existing bounds, then is nudged down until it overlaps nothing. When no
 * node has a position the whole graph is laid out with {@link layoutWorkflow}.
 *
 * @param workflow the workflow to place
 * @returns the same object when nothing needed placing, otherwise a copy with positions filled in
 */
export function placeNewNodes(workflow: Workflow): Workflow {
  const missing = workflow.nodes.filter(node => !hasPosition(node));
  if (missing.length === 0) return workflow;
  if (missing.length === workflow.nodes.length) {
    return { ...workflow, nodes: layoutWorkflow(workflow.nodes, workflow.edges) };
  }
  const byId = new Map(workflow.nodes.map(node => [node.id, node]));
  const placed = new Map<string, Point>(workflow.nodes.filter(hasPosition).map(node => [node.id, node.position!]));
  const initial = [...placed.entries()];
  const minX = Math.min(...initial.map(([, p]) => p.x));
  const maxBottom = Math.max(...initial.map(([id, p]) => p.y + sizeOf(byId.get(id)!).height));
  const average = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
  const overlaps = (node: WorkflowNode, p: Point) => [...placed.entries()].some(([id, q]) => {
    const a = sizeOf(node);
    const b = sizeOf(byId.get(id)!);
    return p.x < q.x + b.width && q.x < p.x + a.width && p.y < q.y + b.height && q.y < p.y + a.height;
  });

  for (const node of missing) {
    const preds = workflow.edges.filter(e => e.target === node.id && placed.has(e.source)).map(e => e.source);
    const succs = workflow.edges.filter(e => e.source === node.id && placed.has(e.target)).map(e => e.target);
    let position: Point;
    if (preds.length) {
      position = {
        x: Math.max(...preds.map(id => placed.get(id)!.x + sizeOf(byId.get(id)!).width)) + PLACEMENT_GAP_X,
        y: average(preds.map(id => placed.get(id)!.y)),
      };
    } else if (succs.length) {
      position = {
        x: Math.min(...succs.map(id => placed.get(id)!.x)) - sizeOf(node).width - PLACEMENT_GAP_X,
        y: average(succs.map(id => placed.get(id)!.y)),
      };
    } else {
      position = { x: minX, y: maxBottom + PLACEMENT_BELOW };
    }
    while (overlaps(node, position)) {
      position = { x: position.x, y: position.y + sizeOf(node).height + PLACEMENT_GAP_Y };
    }
    placed.set(node.id, position);
  }
  return { ...workflow, nodes: workflow.nodes.map(node => hasPosition(node) ? node : { ...node, position: placed.get(node.id)! }) };
}

/**
 * Chooses the layout for an imported or replaced document: a full layout only for a fully positioned graph
 * whose nodes are stacked on one point (see {@link needsLayout}); otherwise {@link placeNewNodes}.
 *
 * @param workflow the incoming workflow
 * @returns the workflow with every node positioned
 */
export function layoutForImport(workflow: Workflow): Workflow {
  if (workflow.nodes.length >= 2 && workflow.nodes.every(hasPosition) && needsLayout(workflow.nodes)) {
    return { ...workflow, nodes: layoutWorkflow(workflow.nodes, workflow.edges) };
  }
  return placeNewNodes(workflow);
}
