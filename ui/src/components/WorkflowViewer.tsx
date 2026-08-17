import { useMemo } from 'react';
import { ReactFlow, Background, Controls, MiniMap, ReactFlowProvider } from '@xyflow/react';
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

  return (
    <div className="workflow-viewer">
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
        <MiniMap />
      </ReactFlow>
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
