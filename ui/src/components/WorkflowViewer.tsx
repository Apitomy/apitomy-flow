import { useMemo, useState, useCallback, useRef } from 'react';
import { ReactFlow, Background, Controls, ReactFlowProvider } from '@xyflow/react';
import { AngleDoubleRightIcon, AngleDoubleLeftIcon } from '@patternfly/react-icons';
import { type Workflow } from '../types/workflow.ts';
import { type WorkflowInstance } from '../types/instance.ts';
import { toReactFlowNodes, toReactFlowEdges } from '../utils/conversion.ts';
import { nodeTypes } from './nodes/nodeTypes.ts';
import { edgeTypes } from './edges/edgeTypes.ts';
import './WorkflowViewer.css';

export interface WorkflowViewerProps {
  workflow: Workflow;
  instance: WorkflowInstance;
}

function WorkflowViewerInner({ workflow, instance }: WorkflowViewerProps) {
  const visitedNodeIds = useMemo(
    () => new Set(instance.history.map(h => h.nodeId)),
    [instance.history],
  );

  const visitedEdgeIds = useMemo(
    () => new Set(instance.history.filter(h => h.edgeId).map(h => h.edgeId!)),
    [instance.history],
  );

  const nodes = useMemo(() => {
    return toReactFlowNodes(workflow.nodes).map(node => {
      const isCurrent = node.id === instance.currentNodeId;
      const isVisited = visitedNodeIds.has(node.id);
      return {
        ...node,
        className: isCurrent ? 'flow-node-current' : isVisited ? 'flow-node-visited' : 'flow-node-unvisited',
        draggable: false,
        selectable: false,
      };
    });
  }, [workflow.nodes, instance.currentNodeId, visitedNodeIds]);

  const edges = useMemo(() => {
    return toReactFlowEdges(workflow.edges).map(edge => {
      const isVisited = visitedEdgeIds.has(edge.id);
      return {
        ...edge,
        style: {
          ...edge.style,
          strokeWidth: isVisited ? 2.5 : 1,
          stroke: isVisited ? 'var(--pf-t--global--color--status--success--default, #3e8635)' : undefined,
          opacity: isVisited ? 1 : 0.3,
        },
        animated: edge.id === instance.history[instance.history.length - 1]?.edgeId,
      };
    });
  }, [workflow.edges, visitedEdgeIds, instance.history]);

  const [collapsed, setCollapsed] = useState(false);
  const [panelWidth, setPanelWidth] = useState(320);
  const isResizing = useRef(false);

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
    <div className="workflow-viewer">
      <div className="workflow-viewer__canvas">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={false}
          fitView
        >
          <Background />
          <Controls showInteractive={false} />
        </ReactFlow>
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
            Instance Context
            <div className="workflow-viewer__context-actions">
              <span className={`workflow-viewer__status workflow-viewer__status--${instance.status}`}>
                {instance.status}
              </span>
              <button
                className="workflow-viewer__collapse-btn"
                title="Hide instance context"
                onClick={() => setCollapsed(true)}
              >
                <AngleDoubleRightIcon />
              </button>
            </div>
          </div>
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
        </div>
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
