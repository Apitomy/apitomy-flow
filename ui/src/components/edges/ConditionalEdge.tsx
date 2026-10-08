import { useCallback } from 'react';
import {
  BaseEdge, EdgeLabelRenderer, getBezierPath, useStore,
  type EdgeProps, type InternalNode, type ReactFlowState,
} from '@xyflow/react';
import { isLoopBack, loopBackPath, loopLaneY, type Box } from './loopBackRouting.ts';
import './ConditionalEdge.css';

/** Per-simulation-outcome stroke styling for the edge, keyed by the transient `data.simState`. */
const SIM_EDGE_STYLE: Record<string, { stroke?: string; strokeWidth?: number; opacity?: number; strokeDasharray?: string } | undefined> = {
  matched: { stroke: 'var(--flow-status-success, #3e8635)', strokeWidth: 3 },
  true: { stroke: 'var(--flow-status-success, #3e8635)', strokeWidth: 2.5 },
  false: { stroke: 'var(--flow-status-danger, #c9190b)', strokeWidth: 1.5, opacity: 0.6, strokeDasharray: '4 3' },
  skipped: { opacity: 0.25 },
  error: { stroke: 'var(--flow-status-danger, #c9190b)', strokeWidth: 2.5 },
};

/** Stroke colour for loop-back edges; matches the badge's loop icon. */
const LOOP_BACK_COLOR = 'var(--flow-loop-back, #8476d1)';

function boxOf(node: InternalNode): Box {
  const { x, y } = node.internals.positionAbsolute;
  return { x, y, width: node.measured.width ?? 0, height: node.measured.height ?? 0 };
}

/**
 * Lane for a loop-back edge: below every node its span overlaps, and below any loop-back
 * edges nested inside it so stacked loops stay distinguishable.
 */
function computeLaneY(
  s: ReactFlowState, id: string, source: string, target: string, sourceY: number, targetY: number,
): number {
  const span = (src: string, tgt: string): [number, number] | undefined => {
    const a = s.nodeLookup.get(src);
    const b = s.nodeLookup.get(tgt);
    if (!a || !b) return undefined;
    const right = boxOf(a).x + boxOf(a).width;
    const left = boxOf(b).x;
    return isLoopBack(right, left) ? [left, right] : undefined;
  };
  const own = span(source, target);
  if (!own) return Math.max(sourceY, targetY);
  const [minX, maxX] = own;
  const nested = s.edges.filter(edge => {
    if (edge.id === id) return false;
    const other = span(edge.source, edge.target);
    if (!other) return false;
    const inside = other[0] >= minX && other[1] <= maxX;
    const same = other[0] === minX && other[1] === maxX;
    return inside && (!same || edge.id < id);
  }).length;
  const boxes = [...s.nodeLookup.values()].map(boxOf);
  return loopLaneY(minX, maxX, Math.max(sourceY, targetY), boxes, nested);
}

export function ConditionalEdge({
  id, source, target, sourceX, sourceY, targetX, targetY,
  sourcePosition, targetPosition, data, style, markerEnd, selected,
}: EdgeProps) {
  const loopBack = isLoopBack(sourceX, targetX);
  // Only loop-back edges subscribe to a derived number, so forward edges never re-render on
  // unrelated node moves.
  const laneY = useStore(useCallback(
    (s: ReactFlowState) => (loopBack ? computeLaneY(s, id, source, target, sourceY, targetY) : 0),
    [loopBack, id, source, target, sourceY, targetY],
  ));
  const [edgePath, labelX, labelY] = loopBack
    ? loopBackPath(sourceX, sourceY, targetX, targetY, laneY)
    : getBezierPath({
      sourceX, sourceY, sourcePosition,
      targetX, targetY, targetPosition,
    });

  const condition = data?.condition as string | undefined;
  const isDefault = data?.isDefault as boolean | undefined;
  const isTimeout = data?.isTimeout as boolean | undefined;
  const label = data?.label as string | undefined;
  // Transient routing outcome written by the editor during a simulation run. It is never
  // persisted (toWorkflowEdges only saves condition/priority/isDefault/label).
  const simState = data?.simState as
    | 'matched' | 'true' | 'false' | 'skipped' | 'error' | undefined;

  const displayText = label || (isTimeout ? 'timeout' : isDefault ? 'default' : condition);
  const badgeClass = [loopBack ? 'is-loop-back' : '', isDefault ? 'is-default' : '', isTimeout ? 'is-timeout' : '', simState ? `sim-${simState}` : '']
    .filter(Boolean)
    .join(' ');

  const simStroke = SIM_EDGE_STYLE[simState ?? ''];
  // Loop-backs get their own colour unless simulation or selection styling takes precedence.
  const loopTinted = loopBack && !simStroke?.stroke && !selected;
  const loopMarkerId = `flow-loop-arrow-${id}`;

  return (
    <>
      {loopTinted && (
        <defs>
          <marker
            id={loopMarkerId}
            viewBox="-10 -10 20 20"
            markerWidth="12.5"
            markerHeight="12.5"
            orient="auto-start-reverse"
            refX="0"
            refY="0"
          >
            <polyline
              className="edge-loop-arrow"
              strokeLinecap="round"
              strokeLinejoin="round"
              points="-5,-4 0,0 -5,4 -5,-4"
            />
          </marker>
        </defs>
      )}
      <BaseEdge
        id={id}
        path={edgePath}
        style={{
          ...style,
          strokeWidth: simStroke?.strokeWidth ?? (selected ? 2.5 : 1.5),
          stroke: simStroke?.stroke
            ?? (selected ? 'var(--pf-t--global--color--brand--default, #06c)' : undefined)
            ?? (loopTinted ? LOOP_BACK_COLOR : undefined),
          opacity: simStroke?.opacity,
          strokeDasharray: simStroke?.strokeDasharray ?? (isTimeout ? '6 4' : undefined),
        }}
        markerEnd={loopTinted ? `url(#${loopMarkerId})` : markerEnd}
      />
      {(displayText || loopBack) && (
        <EdgeLabelRenderer>
          <div
            className={`edge-condition-badge ${badgeClass}`}
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
              pointerEvents: 'all',
            }}
          >
            {loopBack && (
              <span className="edge-loop-icon" role="img" aria-label="Loops back" title="Loops back to an earlier step">
                ↻
              </span>
            )}
            {loopBack && displayText ? <span className="edge-badge-text">{displayText}</span> : displayText}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}
