import { type NodeTypes } from '@xyflow/react';
import { StartNode } from './StartNode.tsx';
import { EndNode } from './EndNode.tsx';
import { ActionNode } from './ActionNode.tsx';
import { HumanTaskNode } from './HumanTaskNode.tsx';
import { ReceiveEventNode } from './ReceiveEventNode.tsx';

export const nodeTypes: NodeTypes = {
  'start': StartNode,
  'end': EndNode,
  'action': ActionNode,
  'human-task': HumanTaskNode,
  'receive-event': ReceiveEventNode,
};
