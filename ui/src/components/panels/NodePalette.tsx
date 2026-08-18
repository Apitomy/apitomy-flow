import { type DragEvent } from 'react';
import { OutlinedCircleIcon, FlagCheckeredIcon, PlayIcon, UserIcon, EnvelopeIcon } from '@patternfly/react-icons';
import { type NodeType } from '../../types/workflow.ts';
import './NodePalette.css';

const paletteItems: { type: NodeType; label: string; icon: React.ReactNode }[] = [
  { type: 'start', label: 'Start', icon: <OutlinedCircleIcon /> },
  { type: 'action', label: 'Action', icon: <PlayIcon /> },
  { type: 'human-task', label: 'Human Task', icon: <UserIcon /> },
  { type: 'receive-event', label: 'Receive Event', icon: <EnvelopeIcon /> },
  { type: 'end', label: 'End', icon: <FlagCheckeredIcon /> },
];

export function NodePalette() {
  function onDragStart(event: DragEvent, nodeType: NodeType) {
    event.dataTransfer.setData('application/reactflow-nodetype', nodeType);
    event.dataTransfer.effectAllowed = 'move';
  }

  return (
    <div className="node-palette">
      {paletteItems.map(item => (
        <div
          key={item.type}
          className="node-palette__item"
          draggable
          onDragStart={(e) => onDragStart(e, item.type)}
        >
          {item.icon}
          <span>{item.label}</span>
        </div>
      ))}
    </div>
  );
}
