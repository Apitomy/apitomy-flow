import { Handle, Position, type NodeProps } from '@xyflow/react';
import { EnvelopeIcon } from '@patternfly/react-icons';
import { type FlowNodeData } from '../../utils/conversion.ts';
import './ReceiveEventNode.css';

export function ReceiveEventNode({ data, selected }: NodeProps) {
  const nodeData = data as FlowNodeData;
  const validationClass = nodeData.validationSeverity === 'error' ? 'has-error'
    : nodeData.validationSeverity === 'warning' ? 'has-warning' : '';

  return (
    <div className={`flow-node-receive-event ${validationClass} ${selected ? 'selected' : ''}`}>
      <Handle type="target" position={Position.Left} />
      <EnvelopeIcon />
      <span>{nodeData.name}</span>
      <Handle type="source" position={Position.Right} />
    </div>
  );
}
