import { type ComponentType } from 'react';
import { type NodeProps } from '@xyflow/react';
import { type FlowNodeData } from '../../utils/conversion.ts';
import './parallelHint.css';

const HINT_LABEL: Record<'fork' | 'join', string> = {
  fork: 'Fork',
  join: 'Join',
};

const HINT_TITLE: Record<'fork' | 'join', string> = {
  fork: 'Fork: all outgoing branches run in parallel',
  join: 'Join: waits for all parallel branches to arrive',
};

/**
 * Wraps a node component to render a small corner hint when the node is a parallel fork or join.
 * Renders nothing when {@code data.parallelRole} is unset (e.g. in the read-only viewer).
 *
 * @param Node the node component to wrap
 * @returns the wrapped component
 */
export function withParallelHint(
  Node: ComponentType<NodeProps>,
): ComponentType<NodeProps> {
  return function ParallelHintNode(props: NodeProps) {
    const role = (props.data as FlowNodeData).parallelRole;
    return (
      <div className="flow-parallel-hint-wrap">
        <Node {...props} />
        {role && (
          <span
            className={`flow-parallel-hint flow-parallel-hint-${role}`}
            title={HINT_TITLE[role]}
          >
            {HINT_LABEL[role]}
          </span>
        )}
      </div>
    );
  };
}
