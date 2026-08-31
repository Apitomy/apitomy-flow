import dagre from '@dagrejs/dagre';
import { type WorkflowNode, type WorkflowEdge, type NodeType } from '../types/workflow.ts';

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

  const first = nodes[0].position;
  const allSame = nodes.every(n =>
    Math.abs(n.position.x - first.x) < 1 && Math.abs(n.position.y - first.y) < 1);
  return allSame;
}
