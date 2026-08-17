import { BaseEdge, EdgeLabelRenderer, getBezierPath, type EdgeProps } from '@xyflow/react';
import './ConditionalEdge.css';

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

  const displayText = label || (isDefault ? 'default' : condition);
  const badgeClass = isDefault ? 'is-default' : '';

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        style={{
          ...style,
          strokeWidth: selected ? 2.5 : 1.5,
          stroke: selected ? 'var(--pf-t--global--color--brand--default, #06c)' : undefined,
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
