import { type CSSProperties } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { PlayIcon } from '@patternfly/react-icons';
import { type FlowNodeData } from '../../utils/conversion.ts';
import './ActionNode.css';

export function ActionNode({ data, selected }: NodeProps) {
  const nodeData = data as FlowNodeData;
  const appearance = nodeData.actionAppearance;
  const style = appearance?.color
    ? ({ '--flow-node-action-accent': appearance.color } as CSSProperties)
    : undefined;

  return (
    <div className={`flow-node-action ${selected ? 'selected' : ''}`} style={style}>
      <Handle type="target" position={Position.Left} />
      <span className="flow-node-action-icon" aria-hidden="true">{appearance?.icon ?? <PlayIcon />}</span>
      <span>{nodeData.name}</span>
      {nodeData.retryBadge && (
        <span className="flow-node-action-retry" title={nodeData.retryBadge.title}>{nodeData.retryBadge.label}</span>
      )}
      <Handle type="source" position={Position.Right} />
    </div>
  );
}
