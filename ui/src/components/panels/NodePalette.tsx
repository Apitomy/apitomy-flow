import { type DragEvent } from 'react';
import { PlayIcon, FlagCheckeredIcon, CogIcon, UserIcon, BoltIcon } from '@patternfly/react-icons';
import { type NodeType } from '../../types/workflow.ts';
import './NodePalette.css';

const paletteItems: { type: NodeType; label: string; icon: React.ReactNode }[] = [
  { type: 'start', label: 'Start', icon: <PlayIcon /> },
  { type: 'action', label: 'Action', icon: <CogIcon /> },
  { type: 'human-task', label: 'Human Task', icon: <UserIcon /> },
  { type: 'receive-event', label: 'Receive Event', icon: <BoltIcon /> },
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
