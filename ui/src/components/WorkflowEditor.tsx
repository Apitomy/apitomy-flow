import { useCallback, useMemo, useState, useEffect, useRef, useId, type DragEvent } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  ControlButton,
  Panel,
  type Connection,
  type Node,
  type Edge,
  type NodeChange,
  type EdgeChange,
  useReactFlow,
  ReactFlowProvider,
} from '@xyflow/react';
import { Switch } from '@patternfly/react-core';
import { UndoIcon, RedoIcon, LockIcon, LockOpenIcon, UploadIcon, DownloadIcon, ImageIcon } from '@patternfly/react-icons';
import { type Workflow } from '../types/workflow.ts';
import { type ValidationProblem } from '../types/validation.ts';
import { type EditorSpi } from '../types/spi.ts';
import { type FlowNodeData } from '../utils/conversion.ts';
import { generateNodeId, generateEdgeId } from '../utils/id.ts';
import { parseWorkflow, downloadWorkflowJson, workflowFileName } from '../utils/workflowIo.ts';
import { exportCanvasImage } from '../utils/exportImage.ts';
import { simNodeClass, activeNodeIds, parallelRole } from '../utils/parallelView.ts';
import { validateWorkflow } from '../validation/validateWorkflow.ts';
import { analyzeParallelRegions } from '../simulation/parallelRegions.ts';
import { useHostValidation } from '../hooks/useHostValidation.ts';
import { nodeTypes } from './nodes/nodeTypes.ts';
import { edgeTypes } from './edges/edgeTypes.ts';
import { NodePalette } from './panels/NodePalette.tsx';
import { PropertiesPanel } from './panels/PropertiesPanel.tsx';
import { ProblemsPanel } from './panels/ProblemsPanel.tsx';
import { SimulationPanel } from './panels/SimulationPanel.tsx';
import { NodeContextMenu } from './NodeContextMenu.tsx';
import { useEditorState } from '../hooks/useEditorState.ts';
import { editorShortcut } from '../hooks/editorShortcuts.ts';
import { deleteWithEditorFocus } from '../hooks/editorDeletion.ts';
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

export interface WorkflowEditorProps {
  workflow: Workflow;
  onChange: (workflow: Workflow) => void;
  onValidationChange?: (problems: ValidationProblem[]) => void;
  theme?: FlowTheme;
  spi?: EditorSpi;
}

function WorkflowEditorInner({ workflow, onChange, onValidationChange, theme = 'light', spi }: WorkflowEditorProps) {
  const { state, dispatch } = useEditorState(workflow, onChange);
  const { nodes, edges, selectedNodeId, selectedEdgeId, simulating: simActive, interactive } = state;
  const currentWorkflow = state.document;
  const { screenToFlowPosition, fitView, getNodes } = useReactFlow();
  const canUndo = state.past.length > 0 && !simActive;
  const canRedo = state.future.length > 0 && !simActive;
  const simulateSwitchId = useId();
  const typingSession = useRef(0);

  const [importError, setImportError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const editorRootRef = useRef<HTMLDivElement>(null);
  const [contextMenu, setContextMenu] = useState<{ node: Node<FlowNodeData>; position: { x: number; y: number } } | null>(null);
  const [panelWidth, setPanelWidth] = useState(340);
  const [simState, setSimState] = useState<SimState | null>(null);
  const [simContextText, setSimContextText] = useState('{\n  \n}');

  // Canvas interactivity (drag/connect/select). Locked automatically while simulating so the graph
  // can't be edited mid-run; otherwise controlled by the lower-left lock button.
  const interactivityEnabled = interactive && !simActive;
  const isResizing = useRef(false);

  const selectedNode = nodes.find(n => n.id === selectedNodeId);
  const selectedEdge = edges.find(e => e.id === selectedEdgeId);

  const builtInProblems = useMemo(
    () => validateWorkflow(currentWorkflow),
    [currentWorkflow],
  );

  const parallelAnalysis = useMemo(
    () => analyzeParallelRegions(currentWorkflow),
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
    if (!validationProblems?.length && !parallelAnalysis) return nodes;
    return nodes.map(node => {
      const problems = validationProblems.filter(p => p.nodeId === node.id);
      const role = parallelRole(node.id, parallelAnalysis);
      return (problems.length || role) ? {
        ...node,
        data: {
          ...node.data,
          validationProblems: problems.length ? problems : undefined,
          parallelRole: role,
        },
      } : node;
    });
  }, [nodes, validationProblems, parallelAnalysis]);

  const selectedNodeProblems = useMemo(
    () => (selectedNodeId ? validationProblems.filter(p => p.nodeId === selectedNodeId) : []),
    [validationProblems, selectedNodeId],
  );

  const handleNodesChange = useCallback((changes: NodeChange<Node<FlowNodeData>>[]) => {
    dispatch({ type: 'nodesChange', changes });
  }, [dispatch]);

  const handleEdgesChange = useCallback((changes: EdgeChange[]) => {
    dispatch({ type: 'edgesChange', changes });
  }, [dispatch]);

  const onConnect = useCallback((connection: Connection) => {
    dispatch({ type: 'connect', connection, id: generateEdgeId(connection.source, connection.target) });
  }, [dispatch]);

  const onDrop = useCallback((event: DragEvent) => {
    event.preventDefault();
    const nodeType = event.dataTransfer.getData('application/reactflow-nodetype');
    if (!nodeType) return;

    const position = screenToFlowPosition({ x: event.clientX, y: event.clientY });
    dispatch({ type: 'addNode', node: {
      id: generateNodeId(nodeType),
      type: nodeType as FlowNodeData['nodeType'],
      position,
      name: nodeType.charAt(0).toUpperCase() + nodeType.slice(1).replace(/-/g, ' '),
      config: nodeType === 'action' ? { actionType: '' } : nodeType === 'wait' ? { duration: '' } : {},
    } });
  }, [screenToFlowPosition, dispatch]);

  const onDragOver = useCallback((event: DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }, []);

  const onNodeClick = useCallback((_: any, node: Node) => {
    dispatch({ type: 'select', nodeId: node.id });
  }, [dispatch]);

  const onEdgeClick = useCallback((_: any, edge: Edge) => {
    dispatch({ type: 'select', edgeId: edge.id });
  }, [dispatch]);

  const onPaneClick = useCallback(() => {
    dispatch({ type: 'select' });
    setContextMenu(null);
  }, [dispatch]);

  const onNodeContextMenu = useCallback((event: React.MouseEvent, node: Node<FlowNodeData>) => {
    event.preventDefault();
    if (!interactivityEnabled) return;
    setContextMenu({ node: node as Node<FlowNodeData>, position: { x: event.clientX, y: event.clientY } });
  }, [interactivityEnabled]);

  const onCloneNode = useCallback((node: Node<FlowNodeData>) => {
    dispatch({ type: 'cloneNode', id: node.id, newId: generateNodeId(node.data.nodeType) });
  }, [dispatch]);

  const onDeleteNode = useCallback((nodeId: string) => {
    deleteWithEditorFocus(state, { type: 'delete', nodeIds: [nodeId] }, editorRootRef.current, dispatch);
  }, [state, dispatch]);

  const onNodeDragStop = useCallback(() => {
    dispatch({ type: 'commitPositions' });
  }, [dispatch]);

  const handleTidyUp = useCallback(() => {
    dispatch({ type: 'tidy' });
    window.requestAnimationFrame(() => fitView({ duration: 300 }));
  }, [dispatch, fitView]);

  // --- Import / export ----------------------------------------------------
  // Replaces the canvas with an imported definition. Applies fallback layout when
  // node positions are missing and reframes the view so the whole graph is shown.
  const applyImportedWorkflow = useCallback((imported: Workflow) => {
    dispatch({ type: 'import', workflow: imported });
    window.requestAnimationFrame(() => fitView({ duration: 300 }));
  }, [dispatch, fitView]);

  const onImportFileChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = ''; // reset so re-selecting the same file fires change again
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const result = parseWorkflow(String(reader.result ?? ''));
      if (result.error) {
        setImportError(`Import failed: ${result.error}`);
        return;
      }
      if (!result.workflow) {
        const errorCount = result.problems.filter(p => p.severity === 'error').length;
        setImportError(`Import rejected: the definition has ${errorCount} validation error${errorCount === 1 ? '' : 's'}. Fix them and try again.`);
        return;
      }
      setImportError(null);
      applyImportedWorkflow(result.workflow);
    };
    reader.onerror = () => setImportError('Import failed: could not read the selected file.');
    reader.readAsText(file);
  }, [applyImportedWorkflow]);

  const handleImportClick = useCallback(() => {
    if (simActive) return;
    fileInputRef.current?.click();
  }, [simActive]);

  const handleExportJson = useCallback(() => {
    downloadWorkflowJson(currentWorkflow);
  }, [currentWorkflow]);

  const handleExportImage = useCallback(() => {
    const background = theme === 'dark' ? '#1b1b1b' : '#ffffff';
    void exportCanvasImage(getNodes(), `${workflowFileName(currentWorkflow)}.png`, background, editorRootRef.current);
  }, [getNodes, currentWorkflow, theme]);

  // Only text-like controls coalesce. Repeated add/remove buttons, checkboxes, and selects are
  // separate operations even when focus stays on the same control. Blur ends a typing session.
  const typingGroup = useCallback((field: string): string | undefined => {
    const active = document.activeElement;
    const textControl = active instanceof HTMLTextAreaElement
      || (active instanceof HTMLInputElement && !['checkbox', 'radio', 'file', 'button'].includes(active.type))
      || (active instanceof HTMLElement && active.isContentEditable);
    return textControl && editorRootRef.current?.contains(active)
      ? `${field}:${typingSession.current}` : undefined;
  }, []);

  const onNodeDataChange = useCallback((id: string, dataUpdate: Partial<FlowNodeData>) => {
    dispatch({ type: 'nodeData', id, data: dataUpdate,
      group: typingGroup(`node:${id}:${Object.keys(dataUpdate).join(',')}`) });
  }, [dispatch, typingGroup]);

  const onNodeIdChange = useCallback((oldId: string, newId: string) => {
    dispatch({ type: 'renameNode', id: oldId, newId, group: typingGroup('nodeId') });
  }, [dispatch, typingGroup]);

  const onEdgeDataChange = useCallback((id: string, dataUpdate: Record<string, any>) => {
    dispatch({ type: 'edgeData', id, data: dataUpdate,
      group: typingGroup(`edge:${id}:${Object.keys(dataUpdate).join(',')}`) });
  }, [dispatch, typingGroup]);

  const handleUndo = useCallback(() => {
    dispatch({ type: 'undo' });
  }, [dispatch]);

  const handleRedo = useCallback(() => {
    dispatch({ type: 'redo' });
  }, [dispatch]);

  const onKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    const target = event.target instanceof Element ? event.target : null;
    const owned = target?.closest('[data-workflow-editor]') === event.currentTarget;
    const textEditing = !!target?.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"], .monaco-editor');
    const shortcut = editorShortcut({ key: event.key, ctrlKey: event.ctrlKey, metaKey: event.metaKey,
      shiftKey: event.shiftKey, altKey: event.altKey, defaultPrevented: event.defaultPrevented,
      isComposing: event.nativeEvent.isComposing }, owned, textEditing, simActive);
    if (!shortcut || (shortcut === 'delete' && !interactivityEnabled)) return;
    event.preventDefault();
    event.stopPropagation();
    if (shortcut === 'delete') {
      deleteWithEditorFocus(state, { type: 'delete',
        nodeIds: nodes.filter(node => node.selected).map(node => node.id),
        edgeIds: edges.filter(edge => edge.selected).map(edge => edge.id),
      }, editorRootRef.current, dispatch);
    } else {
      dispatch({ type: shortcut });
    }
  }, [dispatch, nodes, edges, simActive, interactivityEnabled, state]);

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
      dispatch({ type: 'select', nodeId: problem.nodeId });
      const node = nodes.find(n => n.id === problem.nodeId);
      if (node) {
        fitView({ nodes: [node], duration: 300 });
      }
    } else if (problem.edgeId) {
      dispatch({ type: 'select', edgeId: problem.edgeId });
    }
  }, [nodes, fitView, dispatch]);

  // --- Simulation ---------------------------------------------------------
  const focusNode = useCallback((nodeId: string) => {
    dispatch({ type: 'select', nodeId });
    const node = nodes.find(n => n.id === nodeId);
    if (node) fitView({ nodes: [node], duration: 300 });
  }, [nodes, fitView, dispatch]);

  const focusEdge = useCallback((edgeId: string) => {
    dispatch({ type: 'select', edgeId });
  }, [dispatch]);

  const beginSim = useCallback((context: Record<string, unknown>) => {
    setSimState(startSimulation(currentWorkflow, context));
  }, [currentWorkflow]);

  const stepSim = useCallback(() => {
    setSimState(prev => (prev ? stepSimulation(currentWorkflow, prev) : prev));
  }, [currentWorkflow]);

  const runSim = useCallback(() => {
    setSimState(prev => (prev ? runSimulation(currentWorkflow, prev) : prev));
  }, [currentWorkflow]);

  const resumeSim = useCallback((mock: SimMock, nodeId?: string) => {
    setSimState(prev => (prev ? resumeSimulation(currentWorkflow, prev, mock, nodeId) : prev));
  }, [currentWorkflow]);

  const resetSim = useCallback(() => setSimState(null), []);

  const toggleSim = useCallback(() => {
    dispatch({ type: 'mode', simulating: !simActive });
    setContextMenu(null);
    if (simActive) {
      setSimState(null);
    } else {
      // Entering sim mode: auto-generate a sample start context, unless the author has already
      // supplied one. Invalid JSON is left untouched so an in-progress edit is not discarded.
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
  }, [currentWorkflow, simActive, dispatch]);

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
    const parkedIds = activeNodeIds(
      simState.activeBranches.filter(b => simState.parkedBranchIds.includes(b.branchId)),
    );
    const activeIds = activeNodeIds(simState.activeBranches, simState.parkedBranchIds);
    const failedNodeId = simState.status === 'failed' ? simState.error?.nodeId : undefined;
    return nodesWithValidation.map(n => ({
      ...n,
      className: simNodeClass(n.id, { activeIds, parkedIds, visited, failedNodeId }),
    }));
  }, [nodesWithValidation, simActive, simState]);

  const displayEdges = useMemo(() => {
    if (!simActive || !simState) return edges;
    return edges.map(e => {
      const evaluation = simState.edgeEvaluations[e.id];
      return { ...e, data: { ...e.data, simState: evaluation?.result } };
    });
  }, [edges, simActive, simState]);

  return (
    <div ref={editorRootRef} className="workflow-editor" data-flow-theme={theme}
      data-workflow-editor tabIndex={-1} onKeyDown={onKeyDown}
      onPointerDownCapture={(event) => {
        const target = event.target instanceof Element ? event.target : null;
        const focusable = target?.closest('input, textarea, select, button, a, [tabindex], [contenteditable]');
        if (target?.closest('[data-workflow-editor]') === event.currentTarget
          && (!focusable || focusable === event.currentTarget || target?.classList.contains('react-flow__pane'))) {
          event.currentTarget.focus({ preventScroll: true });
        }
      }}
      onBlurCapture={() => { typingSession.current += 1; dispatch({ type: 'endGroup' }); }}
    >
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
            deleteKeyCode={null}
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
                onClick={() => dispatch({ type: 'mode', interactive: !interactive })}
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
                <button title="Tidy up (auto-layout)" disabled={!interactivityEnabled} onClick={handleTidyUp}>
                  Tidy up
                </button>
                <button title="Import workflow from a JSON file" disabled={simActive} onClick={handleImportClick}>
                  <UploadIcon /> Import
                </button>
                <button title="Export workflow to a JSON file" onClick={handleExportJson}>
                  <DownloadIcon /> Export
                </button>
                <button title="Export the canvas as a PNG image" onClick={handleExportImage}>
                  <ImageIcon /> Image
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="application/json,.json"
                  style={{ display: 'none' }}
                  onChange={onImportFileChange}
                />
                <Switch
                  id={simulateSwitchId}
                  className="workflow-editor__sim-switch"
                  label="Simulate"
                  aria-label="Simulate routing against a sample context"
                  isChecked={simActive}
                  onChange={toggleSim}
                />
              </div>
            </Panel>
            {importError && (
              <Panel position="top-center">
                <div className="workflow-editor__import-error" role="alert">
                  <span>{importError}</span>
                  <button
                    type="button"
                    aria-label="Dismiss import error"
                    onClick={() => setImportError(null)}
                  >
                    &times;
                  </button>
                </div>
              </Panel>
            )}
          </ReactFlow>
          {contextMenu && interactivityEnabled && (
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
            draftIdentity={`${selectedNodeId ? state.nodeKeys[selectedNodeId] : ''}:${state.draftReset}`}
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

/** Embeds an isolated workflow authoring canvas and its property/simulation panels. */
export function WorkflowEditor(props: WorkflowEditorProps) {
  return (
    <ReactFlowProvider>
      <WorkflowEditorInner {...props} />
    </ReactFlowProvider>
  );
}
