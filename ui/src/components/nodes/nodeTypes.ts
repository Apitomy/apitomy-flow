import { type NodeTypes } from '@xyflow/react';
import { StartNode } from './StartNode.tsx';
import { EndNode } from './EndNode.tsx';
import { ActionNode } from './ActionNode.tsx';
import { HumanTaskNode } from './HumanTaskNode.tsx';
import { ReceiveEventNode } from './ReceiveEventNode.tsx';
import { WaitNode } from './WaitNode.tsx';
import { withCurrentRing } from './currentNodeRing.tsx';

export const nodeTypes: NodeTypes = {
  'start': withCurrentRing(StartNode),
  'end': withCurrentRing(EndNode),
  'action': withCurrentRing(ActionNode),
  'human-task': withCurrentRing(HumanTaskNode),
  'receive-event': withCurrentRing(ReceiveEventNode),
  'wait': withCurrentRing(WaitNode),
};
