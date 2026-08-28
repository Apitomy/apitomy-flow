import { useMemo, useState, useCallback, useRef } from 'react';
import { ReactFlow, Background, Controls, ReactFlowProvider, type Node } from '@xyflow/react';
import { AngleDoubleRightIcon, AngleDoubleLeftIcon } from '@patternfly/react-icons';
import { type HistoryEntry, type InstanceStatus } from '../types/instance.ts';
import { type Workflow } from '../types/workflow.ts';
import { type WorkflowInstance } from '../types/instance.ts';
import { toReactFlowNodes, toReactFlowEdges } from '../utils/conversion.ts';
import { type FlowTheme } from './WorkflowEditor.tsx';
import { nodeTypes } from './nodes/nodeTypes.ts';
import { edgeTypes } from './edges/edgeTypes.ts';
import { NodeActionMenu } from './NodeActionMenu.tsx';
import './theme.css';
import './WorkflowViewer.css';

/**
 * A host-contributed action shown in a node's right-click context menu.
 */
export interface WorkflowViewerNodeMenuItem {
  /** Stable identifier, used as the React key. */
  id: string;
  /** Text displayed for the menu item. */
  label: string;
  /** Optional leading icon rendered before the label. */
  icon?: React.ReactNode;
  /** When true, the item is rendered using the danger (destructive) style. */
  danger?: boolean;
  /** Invoked with the clicked node's id when the item is selected. */
  onSelect: (nodeId: string) => void;
}

export interface WorkflowViewerProps {
  workflow: Workflow;
  instance: WorkflowInstance;
  theme?: FlowTheme;
  /**
   * Host-contributed actions for a node's right-click context menu. Provide a
   * static array, or a function to compute items per node (e.g. only offer
   * "Open trace" for nodes that ran). When omitted or resolving to an empty
   * list, no custom menu opens and the browser default is left untouched.
   */
  nodeContextMenuItems?:
    | WorkflowViewerNodeMenuItem[]
    | ((nodeId: string) => WorkflowViewerNodeMenuItem[]);
}

function WorkflowViewerInner({ workflow, instance, theme = 'light', nodeContextMenuItems }: WorkflowViewerProps) {
  const visitedNodeIds = useMemo(
    () => new Set(instance.history.map(h => h.nodeId)),
    [instance.history],
  );

  const visitedEdgeIds = useMemo(
    () => new Set(instance.history.filter(h => h.edgeId).map(h => h.edgeId!)),
    [instance.history],
  );

  const isTerminal = instance.status === 'completed' || instance.status === 'failed' || instance.status === 'cancelled';

  const nodes = useMemo(() => {
    return toReactFlowNodes(workflow.nodes).map(node => {
      const isCurrent = node.id === instance.currentNodeId;
      const isVisited = visitedNodeIds.has(node.id);
      let className: string;
      if (isCurrent && isTerminal) {
        className = instance.status === 'failed' ? 'flow-node-failed'
          : instance.status === 'cancelled' ? 'flow-node-cancelled'
          : 'flow-node-visited';
      } else if (isCurrent) {
        className = 'flow-node-current';
      } else if (isVisited) {
        className = 'flow-node-visited';
      } else {
        className = 'flow-node-unvisited';
      }
      return {
        ...node,
        className,
        draggable: false,
      };
    });
  }, [workflow.nodes, instance.currentNodeId, instance.status, isTerminal, visitedNodeIds]);

  const edges = useMemo(() => {
    return toReactFlowEdges(workflow.edges).map(edge => {
      const isVisited = visitedEdgeIds.has(edge.id);
      return {
        ...edge,
        style: {
          ...edge.style,
          strokeWidth: isVisited ? 2.5 : 1,
          stroke: isVisited ? 'var(--flow-status-success, #3e8635)' : undefined,
          opacity: isVisited ? 1 : 0.3,
        },
        animated: edge.id === instance.history[instance.history.length - 1]?.edgeId,
      };
    });
  }, [workflow.edges, visitedEdgeIds, instance.history]);

  const [collapsed, setCollapsed] = useState(false);
  const [panelWidth, setPanelWidth] = useState(320);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{ nodeId: string; x: number; y: number } | null>(null);
  const isResizing = useRef(false);

  const resolveMenuItems = useCallback((nodeId: string): WorkflowViewerNodeMenuItem[] => {
    if (!nodeContextMenuItems) return [];
    return typeof nodeContextMenuItems === 'function'
      ? nodeContextMenuItems(nodeId)
      : nodeContextMenuItems;
  }, [nodeContextMenuItems]);

  const selectedNodeHistory = useMemo(() => {
    if (!selectedNodeId) return null;
    return instance.history.find(h => h.nodeId === selectedNodeId) ?? null;
  }, [selectedNodeId, instance.history]);

  const selectedWorkflowNode = useMemo(() => {
    if (!selectedNodeId) return null;
    return workflow.nodes.find(n => n.id === selectedNodeId) ?? null;
  }, [selectedNodeId, workflow.nodes]);

  const onNodeClick = useCallback((_: any, node: Node) => {
    setSelectedNodeId(node.id);
    if (collapsed) setCollapsed(false);
  }, [collapsed]);

  const onPaneClick = useCallback(() => {
    setSelectedNodeId(null);
    setContextMenu(null);
  }, []);

  const onNodeContextMenu = useCallback((event: React.MouseEvent, node: Node) => {
    event.preventDefault();
    if (resolveMenuItems(node.id).length === 0) return;
    setContextMenu({ nodeId: node.id, x: event.clientX, y: event.clientY });
  }, [resolveMenuItems]);

  const onResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isResizing.current = true;
    const startX = e.clientX;
    const startWidth = panelWidth;

    const onMouseMove = (e: MouseEvent) => {
      if (!isResizing.current) return;
      const newWidth = Math.max(200, Math.min(600, startWidth + (startX - e.clientX)));
      setPanelWidth(newWidth);
    };

    const onMouseUp = () => {
      isResizing.current = false;
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, [panelWidth]);

  return (
    <div className="workflow-viewer" data-flow-theme={theme}>
      <div className="workflow-viewer__canvas">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          nodesDraggable={false}
          nodesConnectable={false}
          colorMode={theme}
          onNodeClick={onNodeClick}
          onNodeContextMenu={onNodeContextMenu}
          onPaneClick={onPaneClick}
          fitView
        >
          <Background />
          <Controls showInteractive={false} />
        </ReactFlow>
        {contextMenu && (
          <NodeActionMenu
            items={resolveMenuItems(contextMenu.nodeId)}
            nodeId={contextMenu.nodeId}
            position={{ x: contextMenu.x, y: contextMenu.y }}
            onClose={() => setContextMenu(null)}
          />
        )}
      </div>
      {collapsed ? (
        <div className="workflow-viewer__context-collapsed">
          <button
            className="workflow-viewer__expand-btn"
            title="Show instance context"
            onClick={() => setCollapsed(false)}
          >
            <AngleDoubleLeftIcon />
          </button>
        </div>
      ) : (
        <div className="workflow-viewer__context" style={{ width: panelWidth }}>
          <div className="workflow-viewer__resize-handle" onMouseDown={onResizeStart} />
          <div className="workflow-viewer__context-header">
            {selectedNodeId ? (selectedWorkflowNode?.name ?? selectedNodeId) : 'Instance Context'}
            <div className="workflow-viewer__context-actions">
              {!selectedNodeId && (
                <span className={`workflow-viewer__status workflow-viewer__status--${instance.status}`}>
                  {instance.status}
                </span>
              )}
              {selectedNodeId && (
                <button
                  className="workflow-viewer__collapse-btn"
                  title="Back to instance context"
                  onClick={() => setSelectedNodeId(null)}
                >
                  &times;
                </button>
              )}
              <button
                className="workflow-viewer__collapse-btn"
                title="Hide panel"
                onClick={() => setCollapsed(true)}
              >
                <AngleDoubleRightIcon />
              </button>
            </div>
          </div>
          {selectedNodeId ? (
            <NodeDetail
              node={selectedWorkflowNode}
              history={selectedNodeHistory}
              isCurrent={selectedNodeId === instance.currentNodeId}
              instanceStatus={instance.status}
            />
          ) : (
            <div className="workflow-viewer__context-entries">
              {Object.entries(instance.context).length === 0 ? (
                <div className="workflow-viewer__context-empty">No context values</div>
              ) : (
                Object.entries(instance.context).map(([key, value]) => (
                  <div key={key} className="workflow-viewer__context-entry">
                    <span className="workflow-viewer__context-key">{key}</span>
                    <span className="workflow-viewer__context-value">
                      {typeof value === 'object' ? JSON.stringify(value) : String(value)}
                    </span>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function NodeDetail({ node, history, isCurrent, instanceStatus }: {
  node: WorkflowViewerProps['workflow']['nodes'][number] | null;
  history: HistoryEntry | null;
  isCurrent: boolean;
  instanceStatus: InstanceStatus;
}) {
  if (!node) {
    return <div className="workflow-viewer__context-empty">Node not found</div>;
  }

  const wasVisited = !!history;

  return (
    <div className="workflow-viewer__node-detail">
      <div className="workflow-viewer__context-entry">
        <span className="workflow-viewer__context-key">Type</span>
        <span className="workflow-viewer__context-value">{node.type}</span>
      </div>
      <div className="workflow-viewer__context-entry">
        <span className="workflow-viewer__context-key">Node ID</span>
        <span className="workflow-viewer__context-value">{node.id}</span>
      </div>
      <div className="workflow-viewer__context-entry">
        <span className="workflow-viewer__context-key">Status</span>
        <span className="workflow-viewer__context-value">
          {isCurrent
            ? (instanceStatus === 'completed' ? 'Completed'
              : instanceStatus === 'failed' ? 'Failed'
              : instanceStatus === 'cancelled' ? 'Cancelled'
              : 'Current (waiting)')
            : wasVisited ? 'Completed' : 'Not yet reached'}
        </span>
      </div>
      {history?.enteredOn && (
        <div className="workflow-viewer__context-entry">
          <span className="workflow-viewer__context-key">Entered</span>
          <span className="workflow-viewer__context-value">{new Date(history.enteredOn).toLocaleString()}</span>
        </div>
      )}
      {history?.completedOn && (
        <div className="workflow-viewer__context-entry">
          <span className="workflow-viewer__context-key">Completed</span>
          <span className="workflow-viewer__context-value">{new Date(history.completedOn).toLocaleString()}</span>
        </div>
      )}
      {history?.edgeId && (
        <div className="workflow-viewer__context-entry">
          <span className="workflow-viewer__context-key">Arrived via edge</span>
          <span className="workflow-viewer__context-value">
            {history.edgeCondition ? `${history.edgeId} (${history.edgeCondition})` : history.edgeId}
          </span>
        </div>
      )}
      {node.type === 'start' && Array.isArray(node.config.inputs) && node.config.inputs.length > 0 && (
        <>
          <div className="workflow-viewer__section-label">Inputs</div>
          {(node.config.inputs as { name: string; type: string; required: boolean }[]).map((input) => (
            <div key={input.name} className="workflow-viewer__context-entry">
              <span className="workflow-viewer__context-key">
                {input.name} <span className="workflow-viewer__type-badge">{input.type}{input.required ? '' : '?'}</span>
              </span>
            </div>
          ))}
        </>
      )}
      {history?.output && Object.keys(history.output).length > 0 && (
        <>
          <div className="workflow-viewer__section-label">Outputs</div>
          {Object.entries(history.output).map(([key, value]) => (
            <div key={key} className="workflow-viewer__context-entry">
              <span className="workflow-viewer__context-key">{key}</span>
              <span className="workflow-viewer__context-value">{formatValue(value)}</span>
            </div>
          ))}
        </>
      )}
      {wasVisited && (!history?.output || Object.keys(history.output).length === 0) && (
        <div className="workflow-viewer__context-empty">No outputs recorded</div>
      )}
    </div>
  );
}

export function WorkflowViewer(props: WorkflowViewerProps) {
  return (
    <ReactFlowProvider>
      <WorkflowViewerInner {...props} />
    </ReactFlowProvider>
  );
}
