import { useCallback, useMemo, useState, useEffect, type DragEvent } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  useNodesState,
  useEdgesState,
  addEdge,
  type Connection,
  type Node,
  type Edge,
  useReactFlow,
  ReactFlowProvider,
} from '@xyflow/react';
import { type Workflow } from '../types/workflow.ts';
import { type ValidationProblem } from '../types/validation.ts';
import { type FlowNodeData, toReactFlowNodes, toReactFlowEdges, toWorkflow } from '../utils/conversion.ts';
import { generateNodeId, generateEdgeId } from '../utils/id.ts';
import { validateWorkflow } from '../validation/validateWorkflow.ts';
import { nodeTypes } from './nodes/nodeTypes.ts';
import { edgeTypes } from './edges/edgeTypes.ts';
import { NodePalette } from './panels/NodePalette.tsx';
import { PropertiesPanel } from './panels/PropertiesPanel.tsx';
import { ProblemsPanel } from './panels/ProblemsPanel.tsx';
import { NodeContextMenu } from './NodeContextMenu.tsx';
import './WorkflowEditor.css';

export interface WorkflowEditorProps {
  workflow: Workflow;
  onChange: (workflow: Workflow) => void;
  validationProblems?: ValidationProblem[];
  onValidationChange?: (problems: ValidationProblem[]) => void;
}

function WorkflowEditorInner({ workflow, onChange, onValidationChange }: WorkflowEditorProps) {
  // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: convert once on mount, React Flow manages state after
  const initialNodes = useMemo(() => toReactFlowNodes(workflow.nodes), []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const initialEdges = useMemo(() => toReactFlowEdges(workflow.edges), []);

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);
  const { screenToFlowPosition, fitView } = useReactFlow();

  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{ node: Node<FlowNodeData>; position: { x: number; y: number } } | null>(null);

  const selectedNode = nodes.find(n => n.id === selectedNodeId);
  const selectedEdge = edges.find(e => e.id === selectedEdgeId);

  const currentWorkflow = useMemo(
    () => toWorkflow(workflow.id, workflow.name, nodes, edges),
    [workflow.id, workflow.name, nodes, edges],
  );

  const validationProblems = useMemo(
    () => validateWorkflow(currentWorkflow),
    [currentWorkflow],
  );

  useEffect(() => {
    onValidationChange?.(validationProblems);
  }, [validationProblems, onValidationChange]);

  const nodesWithValidation = useMemo(() => {
    if (!validationProblems?.length) return nodes;
    return nodes.map(node => {
      const problems = validationProblems.filter(p => p.nodeId === node.id);
      const severity: 'error' | 'warning' | undefined = problems.some(p => p.severity === 'error') ? 'error'
        : problems.some(p => p.severity === 'warning') ? 'warning' : undefined;
      return severity ? { ...node, data: { ...node.data, validationSeverity: severity } } : node;
    });
  }, [nodes, validationProblems]);

  const emitChange = useCallback((updatedNodes: Node<FlowNodeData>[], updatedEdges: Edge[]) => {
    onChange(toWorkflow(workflow.id, workflow.name, updatedNodes, updatedEdges));
  }, [workflow.id, workflow.name, onChange]);

  const handleNodesChange: typeof onNodesChange = useCallback((changes) => {
    onNodesChange(changes);
    setNodes(current => {
      const updated = current;
      setTimeout(() => emitChange(updated, edges), 0);
      return current;
    });
  }, [onNodesChange, edges, emitChange, setNodes]);

  const handleEdgesChange: typeof onEdgesChange = useCallback((changes) => {
    onEdgesChange(changes);
    setEdges(current => {
      const updated = current;
      setTimeout(() => emitChange(nodes, updated), 0);
      return current;
    });
  }, [onEdgesChange, nodes, emitChange, setEdges]);

  const onConnect = useCallback((connection: Connection) => {
    const edgeId = generateEdgeId(connection.source!, connection.target!);
    const newEdge: Edge = {
      ...connection,
      id: edgeId,
      type: 'conditional',
      data: { condition: undefined, priority: 0, isDefault: false },
    };
    setEdges(eds => {
      const updated = addEdge(newEdge, eds);
      setTimeout(() => emitChange(nodes, updated), 0);
      return updated;
    });
  }, [setEdges, nodes, emitChange]);

  const onDrop = useCallback((event: DragEvent) => {
    event.preventDefault();
    const nodeType = event.dataTransfer.getData('application/reactflow-nodetype');
    if (!nodeType) return;

    const position = screenToFlowPosition({ x: event.clientX, y: event.clientY });
    const newNode: Node<FlowNodeData> = {
      id: generateNodeId(nodeType),
      type: nodeType,
      position,
      data: {
        name: nodeType.charAt(0).toUpperCase() + nodeType.slice(1).replace(/-/g, ' '),
        nodeType: nodeType as FlowNodeData['nodeType'],
        config: nodeType === 'action' ? { actionType: '' } : {},
      },
    };

    setNodes(nds => {
      const updated = [...nds, newNode];
      setTimeout(() => emitChange(updated, edges), 0);
      return updated;
    });
  }, [screenToFlowPosition, setNodes, edges, emitChange]);

  const onDragOver = useCallback((event: DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }, []);

  const onNodeClick = useCallback((_: any, node: Node) => {
    setSelectedNodeId(node.id);
    setSelectedEdgeId(null);
  }, []);

  const onEdgeClick = useCallback((_: any, edge: Edge) => {
    setSelectedEdgeId(edge.id);
    setSelectedNodeId(null);
  }, []);

  const onPaneClick = useCallback(() => {
    setSelectedNodeId(null);
    setSelectedEdgeId(null);
    setContextMenu(null);
  }, []);

  const onNodeContextMenu = useCallback((event: React.MouseEvent, node: Node<FlowNodeData>) => {
    event.preventDefault();
    setContextMenu({ node: node as Node<FlowNodeData>, position: { x: event.clientX, y: event.clientY } });
  }, []);

  const onCloneNode = useCallback((node: Node<FlowNodeData>) => {
    const newNode: Node<FlowNodeData> = {
      id: generateNodeId(node.data.nodeType),
      type: node.type,
      position: { x: node.position.x + 40, y: node.position.y + 40 },
      data: { ...node.data, name: `${node.data.name} (copy)`, config: { ...node.data.config } },
    };
    setNodes(nds => {
      const updated = [...nds, newNode];
      setTimeout(() => emitChange(updated, edges), 0);
      return updated;
    });
  }, [setNodes, edges, emitChange]);

  const onDeleteNode = useCallback((nodeId: string) => {
    setNodes(nds => {
      const updated = nds.filter(n => n.id !== nodeId);
      setEdges(eds => {
        const updatedEdges = eds.filter(e => e.source !== nodeId && e.target !== nodeId);
        setTimeout(() => emitChange(updated, updatedEdges), 0);
        return updatedEdges;
      });
      if (selectedNodeId === nodeId) setSelectedNodeId(null);
      return updated;
    });
  }, [setNodes, setEdges, emitChange, selectedNodeId]);

  const onNodeDataChange = useCallback((id: string, dataUpdate: Partial<FlowNodeData>) => {
    setNodes(nds => {
      const updated = nds.map(n => n.id === id ? { ...n, data: { ...n.data, ...dataUpdate } } : n);
      setTimeout(() => emitChange(updated, edges), 0);
      return updated;
    });
  }, [setNodes, edges, emitChange]);

  const onEdgeDataChange = useCallback((id: string, dataUpdate: Record<string, any>) => {
    setEdges(eds => {
      const updated = eds.map(e => e.id === id ? { ...e, data: { ...e.data, ...dataUpdate } } : e);
      setTimeout(() => emitChange(nodes, updated), 0);
      return updated;
    });
  }, [setEdges, nodes, emitChange]);

  const onProblemClick = useCallback((problem: ValidationProblem) => {
    if (problem.nodeId) {
      setSelectedNodeId(problem.nodeId);
      setSelectedEdgeId(null);
      const node = nodes.find(n => n.id === problem.nodeId);
      if (node) {
        fitView({ nodes: [node], duration: 300 });
      }
    } else if (problem.edgeId) {
      setSelectedEdgeId(problem.edgeId);
      setSelectedNodeId(null);
    }
  }, [nodes, fitView]);

  return (
    <div className="workflow-editor">
      <NodePalette />
      <div className="workflow-editor__body">
        <div className="workflow-editor__canvas">
          <ReactFlow
            nodes={nodesWithValidation}
            edges={edges}
            onNodesChange={handleNodesChange}
            onEdgesChange={handleEdgesChange}
            onConnect={onConnect}
            onDrop={onDrop}
            onDragOver={onDragOver}
            onNodeClick={onNodeClick}
            onEdgeClick={onEdgeClick}
            onPaneClick={onPaneClick}
            onNodeContextMenu={onNodeContextMenu}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            defaultEdgeOptions={{ type: 'conditional' }}
            fitView
          >
            <Background />
            <Controls />

          </ReactFlow>
          {contextMenu && (
            <NodeContextMenu
              node={contextMenu.node}
              position={contextMenu.position}
              onClone={onCloneNode}
              onDelete={onDeleteNode}
              onClose={() => setContextMenu(null)}
            />
          )}
        </div>
        <PropertiesPanel
          selectedNode={selectedNode}
          selectedEdge={selectedEdge}
          onNodeChange={onNodeDataChange}
          onEdgeChange={onEdgeDataChange}
        />
      </div>
      <ProblemsPanel problems={validationProblems} onProblemClick={onProblemClick} />
    </div>
  );
}

export function WorkflowEditor(props: WorkflowEditorProps) {
  return (
    <ReactFlowProvider>
      <WorkflowEditorInner {...props} />
    </ReactFlowProvider>
  );
}
