import { type Node } from '@xyflow/react';
import { type FlowNodeData } from '../utils/conversion.ts';
import './NodeContextMenu.css';

interface NodeContextMenuProps {
  node: Node<FlowNodeData>;
  position: { x: number; y: number };
  onClone: (node: Node<FlowNodeData>) => void;
  onDelete: (nodeId: string) => void;
  onClose: () => void;
}

export function NodeContextMenu({ node, position, onClone, onDelete, onClose }: NodeContextMenuProps) {
  return (
    <>
      <div className="node-context-menu__backdrop" onClick={onClose} onContextMenu={(e) => { e.preventDefault(); onClose(); }} />
      <div className="node-context-menu" style={{ top: position.y, left: position.x }}>
        <button onClick={() => { onClone(node); onClose(); }}>Clone</button>
        <button className="node-context-menu__danger" onClick={() => { onDelete(node.id); onClose(); }}>Delete</button>
      </div>
    </>
  );
}
