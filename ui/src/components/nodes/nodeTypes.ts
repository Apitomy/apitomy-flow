import { type NodeTypes } from '@xyflow/react';
import { StartNode } from './StartNode.tsx';
import { EndNode } from './EndNode.tsx';
import { ActionNode } from './ActionNode.tsx';
import { HumanTaskNode } from './HumanTaskNode.tsx';
import { ReceiveEventNode } from './ReceiveEventNode.tsx';
import { WaitNode } from './WaitNode.tsx';
import { withCurrentRing } from './currentNodeRing.tsx';
import { withValidationBadge } from './validationBadge.tsx';
import { withParallelHint } from './parallelHint.tsx';

export const nodeTypes: NodeTypes = {
  'start': withCurrentRing(withValidationBadge(withParallelHint(StartNode))),
  'end': withCurrentRing(withValidationBadge(withParallelHint(EndNode))),
  'action': withCurrentRing(withValidationBadge(withParallelHint(ActionNode))),
  'human-task': withCurrentRing(withValidationBadge(withParallelHint(HumanTaskNode))),
  'receive-event': withCurrentRing(withValidationBadge(withParallelHint(ReceiveEventNode))),
  'wait': withCurrentRing(withValidationBadge(withParallelHint(WaitNode))),
};
