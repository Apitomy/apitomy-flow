import { useCallback, useMemo, useState, useEffect, useRef, type DragEvent } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  ControlButton,
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
import { Switch } from '@patternfly/react-core';
import { UndoIcon, RedoIcon, LockIcon, LockOpenIcon } from '@patternfly/react-icons';
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
import { SimulationPanel } from './panels/SimulationPanel.tsx';
import { NodeContextMenu } from './NodeContextMenu.tsx';
import { useUndoRedo } from '../hooks/useUndoRedo.ts';
import {
  startSimulation,
  stepSimulation,
  runSimulation,
  resumeSimulation,
  type SimState,
  type SimMock,
} from '../simulation/simulate.ts';
import './theme.css';
import './WorkflowEditor.css';

export type FlowTheme = 'light' | 'dark';

/** A plausible sample value for a declared start-node input, based on its type (and name hints). */
function sampleValueForInput(input: { name: string; type?: string }): unknown {
  switch (input.type) {
    case 'number': return 0;
    case 'boolean': return true;
    case 'object': return {};
    case 'string':
    default: {
      const name = input.name.toLowerCase();
      if (name.includes('email')) return 'user@example.com';
      if (name.includes('url')) return 'https://example.com';
      if (name.endsWith('id')) return `sample-${input.name}`;
      return `sample ${input.name}`;
    }
  }
}

/**
 * Builds a pretty-printed sample start-context JSON from the workflow's start-node declared inputs,
 * so the author gets a ready-to-run context with the right property names and plausible values.
 */
function generateSampleContext(workflow: Workflow): string {
  const startNode = workflow.nodes.find(n => n.type === 'start');
  const inputs = startNode?.config?.inputs;
  const context: Record<string, unknown> = {};
  if (Array.isArray(inputs)) {
    for (const input of inputs) {
      if (input && typeof input.name === 'string') {
        context[input.name] = sampleValueForInput(input);
      }
    }
  }
  return JSON.stringify(context, null, 2);
}

/** The path-highlight class for a node given the current simulation state. */
function simNodeClass(nodeId: string, state: SimState, visited: ReadonlySet<string>): string {
  if (nodeId === state.currentNodeId) {
    if (state.status === 'failed') return 'flow-sim-node-failed';
    if (state.status === 'blocked') return 'flow-sim-node-blocked';
    return 'flow-sim-node-current';
  }
  return visited.has(nodeId) ? 'flow-sim-node-visited' : 'flow-sim-node-idle';
}

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
  const [panelWidth, setPanelWidth] = useState(340);
  const [simActive, setSimActive] = useState(false);
  const [simState, setSimState] = useState<SimState | null>(null);
  const [simContextText, setSimContextText] = useState('{\n  \n}');
  // Canvas interactivity (drag/connect/select). Locked automatically while simulating so the graph
  // can't be edited mid-run; otherwise controlled by the lower-left lock button.
  const [interactive, setInteractive] = useState(true);
  const interactivityEnabled = interactive && !simActive;
  const isResizing = useRef(false);
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

  // --- Simulation ---------------------------------------------------------
  const focusNode = useCallback((nodeId: string) => {
    setSelectedNodeId(nodeId);
    setSelectedEdgeId(null);
    const node = nodes.find(n => n.id === nodeId);
    if (node) fitView({ nodes: [node], duration: 300 });
  }, [nodes, fitView]);

  const focusEdge = useCallback((edgeId: string) => {
    setSelectedEdgeId(edgeId);
    setSelectedNodeId(null);
  }, []);

  const beginSim = useCallback((context: Record<string, unknown>) => {
    setSimState(startSimulation(currentWorkflow, context));
  }, [currentWorkflow]);

  const stepSim = useCallback(() => {
    setSimState(prev => (prev ? stepSimulation(currentWorkflow, prev) : prev));
  }, [currentWorkflow]);

  const runSim = useCallback(() => {
    setSimState(prev => (prev ? runSimulation(currentWorkflow, prev) : prev));
  }, [currentWorkflow]);

  const resumeSim = useCallback((mock: SimMock) => {
    setSimState(prev => (prev ? resumeSimulation(currentWorkflow, prev, mock) : prev));
  }, [currentWorkflow]);

  const resetSim = useCallback(() => setSimState(null), []);

  const toggleSim = useCallback(() => {
    setSimActive(prev => {
      const next = !prev;
      if (!next) {
        setSimState(null); // leaving sim mode clears the run and its overlays
      } else {
        // Entering sim mode: auto-generate a sample start context, unless the author has already
        // supplied one (i.e. the context has at least one key). Invalid JSON is left untouched so
        // an in-progress edit is not discarded.
        setSimContextText(current => {
          try {
            const parsed = JSON.parse(current || '{}');
            const hasKeys = parsed && typeof parsed === 'object' && !Array.isArray(parsed)
              && Object.keys(parsed).length > 0;
            return hasKeys ? current : generateSampleContext(currentWorkflow);
          } catch {
            return current;
          }
        });
      }
      return next;
    });
  }, [currentWorkflow]);

  // A best-effort parse of the sample context, shared with the inline condition tester.
  const sampleContext = useMemo<Record<string, unknown>>(() => {
    try {
      const parsed = JSON.parse(simContextText || '{}');
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }, [simContextText]);

  // Overlay the simulation path onto the canvas nodes/edges. Transient only: the edge overlay is
  // written to a copy, so toWorkflowEdges never persists it into the saved workflow.
  const displayNodes = useMemo(() => {
    if (!simActive || !simState) return nodesWithValidation;
    const visited = new Set(simState.visitedNodeIds);
    return nodesWithValidation.map(n => ({ ...n, className: simNodeClass(n.id, simState, visited) }));
  }, [nodesWithValidation, simActive, simState]);

  const displayEdges = useMemo(() => {
    if (!simActive || !simState) return edges;
    return edges.map(e => {
      const evaluation = simState.edgeEvaluations[e.id];
      return { ...e, data: { ...e.data, simState: evaluation?.result } };
    });
  }, [edges, simActive, simState]);

  return (
    <div className="workflow-editor" data-flow-theme={theme}>
      <NodePalette />
      <div className="workflow-editor__body">
        <div className={`workflow-editor__canvas${simActive ? ' workflow-editor__canvas--simulating' : ''}`}>
          <ReactFlow
            nodes={displayNodes}
            edges={displayEdges}
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
            nodesDraggable={interactivityEnabled}
            nodesConnectable={interactivityEnabled}
            elementsSelectable={interactivityEnabled}
            colorMode={theme}
            fitView
          >
            <Background />
            <Controls showInteractive={false}>
              <ControlButton
                title="Toggle Interactivity"
                aria-label="Toggle Interactivity"
                disabled={simActive}
                onClick={() => setInteractive(v => !v)}
              >
                {interactivityEnabled ? <LockOpenIcon /> : <LockIcon />}
              </ControlButton>
            </Controls>
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
                <Switch
                  id="workflow-editor-simulate-switch"
                  className="workflow-editor__sim-switch"
                  label="Simulate"
                  aria-label="Simulate routing against a sample context"
                  isChecked={simActive}
                  onChange={toggleSim}
                />
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
        {simActive ? (
          <SimulationPanel
            workflow={currentWorkflow}
            simState={simState}
            contextText={simContextText}
            onContextTextChange={setSimContextText}
            onStart={beginSim}
            onStep={stepSim}
            onRun={runSim}
            onReset={resetSim}
            onResume={resumeSim}
            onClose={toggleSim}
            onFocusNode={focusNode}
            onFocusEdge={focusEdge}
            width={panelWidth}
            onResizeStart={onResizeStart}
          />
        ) : (
          <PropertiesPanel
            selectedNode={selectedNode}
            selectedEdge={selectedEdge}
            nodeProblems={selectedNodeProblems}
            onNodeChange={onNodeDataChange}
            onNodeIdChange={onNodeIdChange}
            onEdgeChange={onEdgeDataChange}
            spi={spi}
            sampleContext={sampleContext}
            width={panelWidth}
            onResizeStart={onResizeStart}
          />
        )}
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
