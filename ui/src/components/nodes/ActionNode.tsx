import { Handle, Position, type NodeProps } from '@xyflow/react';
import { PlayIcon } from '@patternfly/react-icons';
import { type FlowNodeData } from '../../utils/conversion.ts';
import './ActionNode.css';

export function ActionNode({ data, selected }: NodeProps) {
  const nodeData = data as FlowNodeData;
  const validationClass = nodeData.validationSeverity === 'error' ? 'has-error'
    : nodeData.validationSeverity === 'warning' ? 'has-warning' : '';

  return (
    <div className={`flow-node-action ${validationClass} ${selected ? 'selected' : ''}`}>
      <Handle type="target" position={Position.Left} />
      <PlayIcon />
      <span>{nodeData.name}</span>
      <Handle type="source" position={Position.Right} />
    </div>
  );
}
