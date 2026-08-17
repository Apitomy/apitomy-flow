import { Handle, Position, type NodeProps } from '@xyflow/react';
import { FlagCheckeredIcon } from '@patternfly/react-icons';
import { type FlowNodeData } from '../../utils/conversion.ts';
import './EndNode.css';

export function EndNode({ data, selected }: NodeProps) {
  const nodeData = data as FlowNodeData;
  const validationClass = nodeData.validationSeverity === 'error' ? 'has-error'
    : nodeData.validationSeverity === 'warning' ? 'has-warning' : '';

  return (
    <div className={`flow-node-end ${validationClass} ${selected ? 'selected' : ''}`}>
      <Handle type="target" position={Position.Left} />
      <FlagCheckeredIcon />
      <span>{nodeData.name}</span>
    </div>
  );
}
