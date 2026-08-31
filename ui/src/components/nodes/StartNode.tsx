import { Handle, Position, type NodeProps } from '@xyflow/react';
import { OutlinedCircleIcon } from '@patternfly/react-icons';
import { type FlowNodeData } from '../../utils/conversion.ts';
import './StartNode.css';

export function StartNode({ data, selected }: NodeProps) {
  const nodeData = data as FlowNodeData;

  return (
    <div className={`flow-node-start ${selected ? 'selected' : ''}`}>
      <OutlinedCircleIcon />
      <span>{nodeData.name}</span>
      <Handle type="source" position={Position.Right} />
    </div>
  );
}
