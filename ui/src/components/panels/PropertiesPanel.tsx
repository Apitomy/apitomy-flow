import { type Node, type Edge } from '@xyflow/react';
import { type FlowNodeData } from '../../utils/conversion.ts';
import './PropertiesPanel.css';

interface PropertiesPanelProps {
  selectedNode?: Node<FlowNodeData>;
  selectedEdge?: Edge;
  onNodeChange: (id: string, data: Partial<FlowNodeData>) => void;
  onEdgeChange: (id: string, data: Record<string, any>) => void;
}

export function PropertiesPanel({ selectedNode, selectedEdge, onNodeChange, onEdgeChange }: PropertiesPanelProps) {
  if (!selectedNode && !selectedEdge) {
    return (
      <div className="properties-panel">
        <div className="properties-panel__empty">
          Select a node or edge to view its properties
        </div>
      </div>
    );
  }

  if (selectedNode) {
    return (
      <div className="properties-panel">
        <div className="properties-panel__header">
          {selectedNode.data.nodeType} Node
        </div>
        <div className="properties-panel__field">
          <label>Name</label>
          <input
            type="text"
            value={selectedNode.data.name}
            onChange={(e) => onNodeChange(selectedNode.id, { name: e.target.value })}
          />
        </div>
        {selectedNode.data.nodeType === 'action' && (
          <div className="properties-panel__field">
            <label>Action Type</label>
            <input
              type="text"
              value={(selectedNode.data.config.actionType as string) || ''}
              onChange={(e) => onNodeChange(selectedNode.id, {
                config: { ...selectedNode.data.config, actionType: e.target.value },
              })}
            />
          </div>
        )}
        {selectedNode.data.nodeType === 'receive-event' && (
          <>
            <div className="properties-panel__field">
              <label>Event Type</label>
              <input
                type="text"
                value={(selectedNode.data.config.eventType as string) || ''}
                onChange={(e) => onNodeChange(selectedNode.id, {
                  config: { ...selectedNode.data.config, eventType: e.target.value },
                })}
              />
            </div>
          </>
        )}
        <div className="properties-panel__field">
          <label>Node ID</label>
          <input type="text" value={selectedNode.id} disabled />
        </div>
      </div>
    );
  }

  if (selectedEdge) {
    return (
      <div className="properties-panel">
        <div className="properties-panel__header">Edge</div>
        <div className="properties-panel__field">
          <label>Label</label>
          <input
            type="text"
            value={(selectedEdge.data?.label as string) || ''}
            onChange={(e) => onEdgeChange(selectedEdge.id, { label: e.target.value })}
          />
        </div>
        <div className="properties-panel__field">
          <label>Condition (EL expression)</label>
          <textarea
            rows={3}
            value={(selectedEdge.data?.condition as string) || ''}
            onChange={(e) => onEdgeChange(selectedEdge.id, { condition: e.target.value })}
          />
        </div>
        <div className="properties-panel__field">
          <label>Priority</label>
          <input
            type="number"
            value={(selectedEdge.data?.priority as number) ?? 0}
            onChange={(e) => onEdgeChange(selectedEdge.id, { priority: parseInt(e.target.value) || 0 })}
          />
        </div>
        <div className="properties-panel__field">
          <label>
            <input
              type="checkbox"
              checked={(selectedEdge.data?.isDefault as boolean) || false}
              onChange={(e) => onEdgeChange(selectedEdge.id, { isDefault: e.target.checked })}
            />
            Default edge (fallback when no conditions match)
          </label>
        </div>
        <div className="properties-panel__field">
          <label>Edge ID</label>
          <input type="text" value={selectedEdge.id} disabled />
        </div>
      </div>
    );
  }

  return null;
}
