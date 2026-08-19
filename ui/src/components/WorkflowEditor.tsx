import { useCallback, useMemo, useState, useEffect, useRef, type DragEvent } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  Panel,
  useNodesState,
  useEdgesState,
  addEdge,
  type Connection,
  type Node,
  type Edge,
  type NodeChange,
  type EdgeChange,
  useReactFlow,
  ReactFlowProvider,
} from '@xyflow/react';
import { UndoIcon, RedoIcon } from '@patternfly/react-icons';
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
import { useUndoRedo } from '../hooks/useUndoRedo.ts';
import './theme.css';
import './WorkflowEditor.css';

export type FlowTheme = 'light' | 'dark';

export interface WorkflowEditorProps {
  workflow: Workflow;
  onChange: (workflow: Workflow) => void;
  validationProblems?: ValidationProblem[];
  onValidationChange?: (problems: ValidationProblem[]) => void;
  theme?: FlowTheme;
}

function WorkflowEditorInner({ workflow, onChange, onValidationChange, theme = 'light' }: WorkflowEditorProps) {
  // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: convert once on mount, React Flow manages state after
  const initialNodes = useMemo(() => toReactFlowNodes(workflow.nodes), []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const initialEdges = useMemo(() => toReactFlowEdges(workflow.edges), []);

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);
  const { screenToFlowPosition, fitView } = useReactFlow();
  const { takeSnapshot, undo, redo, canUndo, canRedo } = useUndoRedo<FlowNodeData>();
  const isRestoringRef = useRef(false);

  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{ node: Node<FlowNodeData>; position: { x: number; y: number } } | null>(null);
  const snapshotNeededRef = useRef(false);

  // Capture initial state as the first snapshot
  const initializedRef = useRef(false);
  useEffect(() => {
    if (!initializedRef.current) {
      initializedRef.current = true;
      takeSnapshot(initialNodes, initialEdges);
    }
  }, [initialNodes, initialEdges, takeSnapshot]);

  // Commit pending snapshots after render — coalesces multiple changes
  // (e.g. node removal + edge removal) into a single undo step
  useEffect(() => {
    if (snapshotNeededRef.current) {
      snapshotNeededRef.current = false;
      takeSnapshot(nodes, edges);
    }
  });

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

  const handleNodesChange = useCallback((changes: NodeChange<Node<FlowNodeData>>[]) => {
    if (!isRestoringRef.current && changes.some(c => c.type === 'remove')) {
      snapshotNeededRef.current = true;
    }
    onNodesChange(changes);
    setNodes(current => {
      setTimeout(() => emitChange(current, edges), 0);
      return current;
    });
  }, [onNodesChange, edges, emitChange, setNodes]);

  const handleEdgesChange = useCallback((changes: EdgeChange[]) => {
    if (!isRestoringRef.current && changes.some(c => c.type === 'remove')) {
      snapshotNeededRef.current = true;
    }
    onEdgesChange(changes);
    setEdges(current => {
      setTimeout(() => emitChange(nodes, current), 0);
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
    snapshotNeededRef.current = true;
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
        config: nodeType === 'action' ? { actionType: '' } : nodeType === 'wait' ? { duration: '' } : {},
      },
    };

    snapshotNeededRef.current = true;
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
    snapshotNeededRef.current = true;
    setNodes(nds => {
      const updated = [...nds, newNode];
      setTimeout(() => emitChange(updated, edges), 0);
      return updated;
    });
  }, [setNodes, edges, emitChange]);

  const onDeleteNode = useCallback((nodeId: string) => {
    snapshotNeededRef.current = true;
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

  const onNodeDragStop = useCallback(() => {
    snapshotNeededRef.current = true;
  }, []);

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

  const handleUndo = useCallback(() => {
    const snapshot = undo();
    if (!snapshot) return;
    isRestoringRef.current = true;
    setNodes(snapshot.nodes);
    setEdges(snapshot.edges);
    setTimeout(() => {
      emitChange(snapshot.nodes, snapshot.edges);
      isRestoringRef.current = false;
    }, 0);
  }, [undo, setNodes, setEdges, emitChange]);

  const handleRedo = useCallback(() => {
    const snapshot = redo();
    if (!snapshot) return;
    isRestoringRef.current = true;
    setNodes(snapshot.nodes);
    setEdges(snapshot.edges);
    setTimeout(() => {
      emitChange(snapshot.nodes, snapshot.edges);
      isRestoringRef.current = false;
    }, 0);
  }, [redo, setNodes, setEdges, emitChange]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        handleUndo();
      } else if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
        e.preventDefault();
        handleRedo();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [handleUndo, handleRedo]);

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
    <div className="workflow-editor" data-flow-theme={theme}>
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
            onNodeDragStop={onNodeDragStop}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            defaultEdgeOptions={{ type: 'conditional' }}
            colorMode={theme}
            fitView
          >
            <Background />
            <Controls />
            <Panel position="top-right">
              <div className="workflow-editor__toolbar">
                <button title="Undo (Ctrl+Z)" disabled={!canUndo} onClick={handleUndo}>
                  <UndoIcon /> Undo
                </button>
                <button title="Redo (Ctrl+Y)" disabled={!canRedo} onClick={handleRedo}>
                  <RedoIcon /> Redo
                </button>
              </div>
            </Panel>
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
