import { Handle, Position, type NodeProps } from '@xyflow/react';
import { PlayIcon } from '@patternfly/react-icons';
import { type FlowNodeData } from '../../utils/conversion.ts';
import './StartNode.css';

export function StartNode({ data, selected }: NodeProps) {
  const nodeData = data as FlowNodeData;
  const validationClass = nodeData.validationSeverity === 'error' ? 'has-error'
    : nodeData.validationSeverity === 'warning' ? 'has-warning' : '';

  return (
    <div className={`flow-node-start ${validationClass} ${selected ? 'selected' : ''}`}>
      <PlayIcon />
      <span>{nodeData.name}</span>
      <Handle type="source" position={Position.Right} />
    </div>
  );
}
