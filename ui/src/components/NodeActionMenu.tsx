import { type WorkflowViewerNodeMenuItem } from './WorkflowViewer.tsx';
import './NodeContextMenu.css';

interface NodeActionMenuProps {
  items: WorkflowViewerNodeMenuItem[];
  nodeId: string;
  position: { x: number; y: number };
  onClose: () => void;
}

/**
 * Generic, data-driven right-click menu for a viewer node. Renders the
 * host-contributed menu items and dispatches the clicked node's id to the
 * item's `onSelect` handler.
 */
export function NodeActionMenu({ items, nodeId, position, onClose }: NodeActionMenuProps) {
  return (
    <>
      <div
        className="node-context-menu__backdrop"
        onClick={onClose}
        onContextMenu={(e) => { e.preventDefault(); onClose(); }}
      />
      <div className="node-context-menu" style={{ top: position.y, left: position.x }}>
        {items.map((item) => (
          <button
            key={item.id}
            className={item.danger ? 'node-context-menu__danger' : undefined}
            onClick={() => { item.onSelect(nodeId); onClose(); }}
          >
            {item.icon}
            {item.label}
          </button>
        ))}
      </div>
    </>
  );
}
