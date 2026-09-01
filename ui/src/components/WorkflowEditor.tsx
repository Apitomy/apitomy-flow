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
import { type EditorSpi } from '../types/spi.ts';
import { type FlowNodeData, toReactFlowNodes, toReactFlowEdges, toWorkflow, toWorkflowNodes, toWorkflowEdges } from '../utils/conversion.ts';
import { generateNodeId, generateEdgeId } from '../utils/id.ts';
import { validateWorkflow } from '../validation/validateWorkflow.ts';
import { layoutWorkflow, needsLayout } from '../layout/layoutWorkflow.ts';
import { useHostValidation } from '../hooks/useHostValidation.ts';
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
  onValidationChange?: (problems: ValidationProblem[]) => void;
  theme?: FlowTheme;
  spi?: EditorSpi;
}

function WorkflowEditorInner({ workflow, onChange, onValidationChange, theme = 'light', spi }: WorkflowEditorProps) {
  const initialNodes = useMemo(() => {
    const source = needsLayout(workflow.nodes)
      ? layoutWorkflow(workflow.nodes, workflow.edges)
      : workflow.nodes;
    return toReactFlowNodes(source);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- convert once on mount
  }, []);
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
  const changeNeededRef = useRef(false);
  const mountedRef = useRef(false);
  const fallbackAppliedRef = useRef(needsLayout(workflow.nodes));

  // Suppress onChange during initial render — ReactFlow fires onNodesChange
  // (dimension measurements, fitView) before the user has interacted.
  useEffect(() => {
    const id = setTimeout(() => { mountedRef.current = true; }, 0);
    return () => clearTimeout(id);
  }, []);

  // Capture initial state as the first snapshot
  const initializedRef = useRef(false);
  useEffect(() => {
    if (!initializedRef.current) {
      initializedRef.current = true;
      takeSnapshot(initialNodes, initialEdges);
    }
  }, [initialNodes, initialEdges, takeSnapshot]);

  // Persist fallback layout on mount
  useEffect(() => {
    if (fallbackAppliedRef.current) {
      fallbackAppliedRef.current = false;
      onChange(toWorkflow(workflow, initialNodes, initialEdges));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once for fallback persistence
  }, []);

  // Commit pending snapshots and emit deferred onChange after render.
  // Using an effect (not setTimeout) ensures we always read the latest
  // nodes/edges state, eliminating stale-closure issues when ReactFlow
  // fires multiple handlers in the same event (e.g. keyboard delete).
  useEffect(() => {
    if (snapshotNeededRef.current) {
      snapshotNeededRef.current = false;
      takeSnapshot(nodes, edges);
    }
    if (changeNeededRef.current && mountedRef.current) {
      changeNeededRef.current = false;
      onChange(toWorkflow(workflow, nodes, edges));
    }
    isRestoringRef.current = false;
  });

  const selectedNode = nodes.find(n => n.id === selectedNodeId);
  const selectedEdge = edges.find(e => e.id === selectedEdgeId);

  const currentWorkflow = useMemo(
    () => toWorkflow(workflow, nodes, edges),
    [workflow, nodes, edges],
  );

  const builtInProblems = useMemo(
    () => validateWorkflow(currentWorkflow),
    [currentWorkflow],
  );

  const hostProblems = useHostValidation(currentWorkflow, spi?.validate);

  const validationProblems = useMemo(
    () => [...builtInProblems, ...hostProblems],
    [builtInProblems, hostProblems],
  );

  useEffect(() => {
    onValidationChange?.(validationProblems);
  }, [validationProblems, onValidationChange]);

  const nodesWithValidation = useMemo(() => {
    if (!validationProblems?.length) return nodes;
    return nodes.map(node => {
      const problems = validationProblems.filter(p => p.nodeId === node.id);
      return problems.length ? { ...node, data: { ...node.data, validationProblems: problems } } : node;
    });
  }, [nodes, validationProblems]);

  const selectedNodeProblems = useMemo(
    () => (selectedNodeId ? validationProblems.filter(p => p.nodeId === selectedNodeId) : []),
    [validationProblems, selectedNodeId],
  );

  const handleNodesChange = useCallback((changes: NodeChange<Node<FlowNodeData>>[]) => {
    if (!isRestoringRef.current && changes.some(c => c.type === 'remove')) {
      snapshotNeededRef.current = true;
    }
    onNodesChange(changes);
    changeNeededRef.current = true;
  }, [onNodesChange]);

  const handleEdgesChange = useCallback((changes: EdgeChange[]) => {
    if (!isRestoringRef.current && changes.some(c => c.type === 'remove')) {
      snapshotNeededRef.current = true;
    }
    onEdgesChange(changes);
    changeNeededRef.current = true;
  }, [onEdgesChange]);

  const onConnect = useCallback((connection: Connection) => {
    const edgeId = generateEdgeId(connection.source!, connection.target!);
    const newEdge: Edge = {
      ...connection,
      id: edgeId,
      type: 'conditional',
      data: { condition: undefined, priority: 0, isDefault: false },
    };
    snapshotNeededRef.current = true;
    setEdges(eds => addEdge(newEdge, eds));
    changeNeededRef.current = true;
  }, [setEdges]);

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
    setNodes(nds => [...nds, newNode]);
    changeNeededRef.current = true;
    setSelectedNodeId(newNode.id);
    setSelectedEdgeId(null);
  }, [screenToFlowPosition, setNodes]);

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
    setNodes(nds => [...nds, newNode]);
    changeNeededRef.current = true;
  }, [setNodes]);

  const onDeleteNode = useCallback((nodeId: string) => {
    snapshotNeededRef.current = true;
    setNodes(nds => {
      setEdges(eds => eds.filter(e => e.source !== nodeId && e.target !== nodeId));
      if (selectedNodeId === nodeId) setSelectedNodeId(null);
      return nds.filter(n => n.id !== nodeId);
    });
    changeNeededRef.current = true;
  }, [setNodes, setEdges, selectedNodeId]);

  const onNodeDragStop = useCallback(() => {
    snapshotNeededRef.current = true;
    changeNeededRef.current = true;
  }, []);

  const handleTidyUp = useCallback(() => {
    takeSnapshot(nodes, edges);
    const workflowNodes = toWorkflowNodes(nodes);
    const laidOut = layoutWorkflow(workflowNodes, toWorkflowEdges(edges));
    const positionById = new Map(laidOut.map(n => [n.id, n.position]));
    setNodes(nds => nds.map(n => {
      const pos = positionById.get(n.id);
      return pos ? { ...n, position: pos } : n;
    }));
    changeNeededRef.current = true;
    window.requestAnimationFrame(() => fitView({ duration: 300 }));
  }, [nodes, edges, takeSnapshot, setNodes, fitView]);

  const onNodeDataChange = useCallback((id: string, dataUpdate: Partial<FlowNodeData>) => {
    setNodes(nds => nds.map(n => n.id === id ? { ...n, data: { ...n.data, ...dataUpdate } } : n));
    changeNeededRef.current = true;
  }, [setNodes]);

  const onNodeIdChange = useCallback((oldId: string, newId: string) => {
    setNodes(nds => {
      if (nds.some(n => n.id === newId)) return nds;
      setEdges(eds => eds.map(e => ({
        ...e,
        source: e.source === oldId ? newId : e.source,
        target: e.target === oldId ? newId : e.target,
      })));
      if (selectedNodeId === oldId) setSelectedNodeId(newId);
      return nds.map(n => n.id === oldId ? { ...n, id: newId } : n);
    });
    changeNeededRef.current = true;
  }, [setNodes, setEdges, selectedNodeId]);

  const onEdgeDataChange = useCallback((id: string, dataUpdate: Record<string, any>) => {
    setEdges(eds => eds.map(e => e.id === id ? { ...e, data: { ...e.data, ...dataUpdate } } : e));
    changeNeededRef.current = true;
  }, [setEdges]);

  const handleUndo = useCallback(() => {
    const snapshot = undo();
    if (!snapshot) return;
    isRestoringRef.current = true;
    setNodes(snapshot.nodes);
    setEdges(snapshot.edges);
    changeNeededRef.current = true;
  }, [undo, setNodes, setEdges]);

  const handleRedo = useCallback(() => {
    const snapshot = redo();
    if (!snapshot) return;
    isRestoringRef.current = true;
    setNodes(snapshot.nodes);
    setEdges(snapshot.edges);
    changeNeededRef.current = true;
  }, [redo, setNodes, setEdges]);

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
            deleteKeyCode={['Backspace', 'Delete']}
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
                <button title="Tidy up (auto-layout)" onClick={handleTidyUp}>
                  Tidy up
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
          nodeProblems={selectedNodeProblems}
          onNodeChange={onNodeDataChange}
          onNodeIdChange={onNodeIdChange}
          onEdgeChange={onEdgeDataChange}
          spi={spi}
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
