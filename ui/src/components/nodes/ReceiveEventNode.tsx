import { Handle, Position, type NodeProps } from '@xyflow/react';
import { EnvelopeIcon, OutlinedClockIcon } from '@patternfly/react-icons';
import { TIMEOUT_HANDLE, type FlowNodeData } from '../../utils/conversion.ts';
import './ReceiveEventNode.css';

/**
 * Receive-event node. When `config.timeout` is set, an extra bottom `timeout` source port is shown;
 * edges drawn from it become the node's timeout edge (`isTimeout: true`).
 */
export function ReceiveEventNode({ data, selected }: NodeProps) {
  const nodeData = data as FlowNodeData;
  const timeout = nodeData.nodeType === 'receive-event' ? nodeData.config.timeout : undefined;

  return (
    <div className={`flow-node-receive-event ${selected ? 'selected' : ''}`}>
      <Handle type="target" position={Position.Left} />
      <EnvelopeIcon />
      <span>{nodeData.name}</span>
      <Handle type="source" position={Position.Right} />
      {timeout && (
        <>
          <span className="flow-node-receive-event__timeout" title="Timeout"><OutlinedClockIcon /> {timeout}</span>
          <Handle
            type="source"
            id={TIMEOUT_HANDLE}
            position={Position.Bottom}
            className="flow-node-receive-event__timeout-handle"
            title="Timeout path"
          />
        </>
      )}
    </div>
  );
}
