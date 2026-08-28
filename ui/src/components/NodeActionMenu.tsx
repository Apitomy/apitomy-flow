import { type WorkflowViewerNodeMenuItem } from './WorkflowViewer.tsx';
import './NodeContextMenu.css';
import './NodeActionMenu.css';

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
  const handleSelect = (item: WorkflowViewerNodeMenuItem) => {
    // Always close the menu, even if the host's handler throws.
    try {
      item.onSelect(nodeId);
    } finally {
      onClose();
    }
  };

  return (
    <>
      <div
        className="node-context-menu__backdrop"
        onClick={onClose}
        onContextMenu={(e) => { e.preventDefault(); onClose(); }}
      />
      <div className="node-context-menu node-action-menu" style={{ top: position.y, left: position.x }}>
        {items.map((item) => (
          <button
            key={item.id}
            className={item.danger ? 'node-context-menu__danger' : undefined}
            onClick={() => handleSelect(item)}
          >
            {item.icon && <span className="node-action-menu__icon">{item.icon}</span>}
            {item.label}
          </button>
        ))}
      </div>
    </>
  );
}
