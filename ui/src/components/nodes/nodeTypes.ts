import { type NodeTypes } from '@xyflow/react';
import { StartNode } from './StartNode.tsx';
import { EndNode } from './EndNode.tsx';
import { ActionNode } from './ActionNode.tsx';
import { HumanTaskNode } from './HumanTaskNode.tsx';
import { ReceiveEventNode } from './ReceiveEventNode.tsx';
import { WaitNode } from './WaitNode.tsx';
import { withCurrentRing } from './currentNodeRing.tsx';
import { withValidationBadge } from './validationBadge.tsx';

export const nodeTypes: NodeTypes = {
  'start': withCurrentRing(withValidationBadge(StartNode)),
  'end': withCurrentRing(withValidationBadge(EndNode)),
  'action': withCurrentRing(withValidationBadge(ActionNode)),
  'human-task': withCurrentRing(withValidationBadge(HumanTaskNode)),
  'receive-event': withCurrentRing(withValidationBadge(ReceiveEventNode)),
  'wait': withCurrentRing(withValidationBadge(WaitNode)),
};
