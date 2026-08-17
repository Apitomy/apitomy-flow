import { Handle, Position, type NodeProps } from '@xyflow/react';
import { UserIcon } from '@patternfly/react-icons';
import { type FlowNodeData } from '../../utils/conversion.ts';
import './HumanTaskNode.css';

export function HumanTaskNode({ data, selected }: NodeProps) {
  const nodeData = data as FlowNodeData;
  const validationClass = nodeData.validationSeverity === 'error' ? 'has-error'
    : nodeData.validationSeverity === 'warning' ? 'has-warning' : '';

  return (
    <div className={`flow-node-human-task ${validationClass} ${selected ? 'selected' : ''}`}>
      <Handle type="target" position={Position.Left} />
      <UserIcon />
      <span>{nodeData.name}</span>
      <Handle type="source" position={Position.Right} />
    </div>
  );
}
