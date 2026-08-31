import { Handle, Position, type NodeProps } from '@xyflow/react';
import { OutlinedClockIcon } from '@patternfly/react-icons';
import { type FlowNodeData } from '../../utils/conversion.ts';
import './WaitNode.css';

export function WaitNode({ data, selected }: NodeProps) {
  const nodeData = data as FlowNodeData;

  return (
    <div className={`flow-node-wait ${selected ? 'selected' : ''}`}>
      <Handle type="target" position={Position.Left} />
      <OutlinedClockIcon />
      <span>{nodeData.name}</span>
      <Handle type="source" position={Position.Right} />
    </div>
  );
}
