import { BaseEdge, EdgeLabelRenderer, getBezierPath, type EdgeProps } from '@xyflow/react';
import './ConditionalEdge.css';

/** Per-simulation-outcome stroke styling for the edge, keyed by the transient `data.simState`. */
const SIM_EDGE_STYLE: Record<string, { stroke?: string; strokeWidth?: number; opacity?: number; strokeDasharray?: string } | undefined> = {
  matched: { stroke: 'var(--flow-status-success, #3e8635)', strokeWidth: 3 },
  true: { stroke: 'var(--flow-status-success, #3e8635)', strokeWidth: 2.5 },
  false: { stroke: 'var(--flow-status-danger, #c9190b)', strokeWidth: 1.5, opacity: 0.6, strokeDasharray: '4 3' },
  skipped: { opacity: 0.25 },
  error: { stroke: 'var(--flow-status-danger, #c9190b)', strokeWidth: 2.5 },
};

export function ConditionalEdge({
  id, sourceX, sourceY, targetX, targetY,
  sourcePosition, targetPosition, data, style, markerEnd, selected,
}: EdgeProps) {
  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX, sourceY, sourcePosition,
    targetX, targetY, targetPosition,
  });

  const condition = data?.condition as string | undefined;
  const isDefault = data?.isDefault as boolean | undefined;
  const label = data?.label as string | undefined;
  // Transient routing outcome written by the editor during a simulation run. It is never
  // persisted (toWorkflowEdges only saves condition/priority/isDefault/label).
  const simState = data?.simState as
    | 'matched' | 'true' | 'false' | 'skipped' | 'error' | undefined;

  const displayText = label || (isDefault ? 'default' : condition);
  const badgeClass = [isDefault ? 'is-default' : '', simState ? `sim-${simState}` : '']
    .filter(Boolean)
    .join(' ');

  const simStroke = SIM_EDGE_STYLE[simState ?? ''];

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        style={{
          ...style,
          strokeWidth: simStroke?.strokeWidth ?? (selected ? 2.5 : 1.5),
          stroke: simStroke?.stroke
            ?? (selected ? 'var(--pf-t--global--color--brand--default, #06c)' : undefined),
          opacity: simStroke?.opacity,
          strokeDasharray: simStroke?.strokeDasharray,
        }}
        markerEnd={markerEnd}
      />
      {displayText && (
        <EdgeLabelRenderer>
          <div
            className={`edge-condition-badge ${badgeClass}`}
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
              pointerEvents: 'all',
            }}
          >
            {displayText}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}
