import { useCallback, useMemo, useState, useEffect, useRef, useId, useImperativeHandle, useLayoutEffect, type DragEvent, type Ref } from 'react';
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
import { buildProposalOverlay, formatCounts, proposalCounts, proposalDetails, validationText } from '../changeset/proposalOverlay.ts';
import { validationDelta } from '../changeset/validationDelta.ts';
import { ProposalReviewBar } from './panels/ProposalReviewBar.tsx';
import { nodeTypes } from './nodes/nodeTypes.ts';
import { edgeTypes } from './edges/edgeTypes.ts';
import { NodePalette } from './panels/NodePalette.tsx';
import { PropertiesPanel } from './panels/PropertiesPanel.tsx';
import { ProblemsPanel } from './panels/ProblemsPanel.tsx';
import { SimulationPanel } from './panels/SimulationPanel.tsx';
import { NodeContextMenu } from './NodeContextMenu.tsx';
import { useEditorState } from '../hooks/useEditorState.ts';
import { editorShortcut } from '../hooks/editorShortcuts.ts';
import { readOnlyCommand } from '../hooks/editorReadOnly.ts';
import { editorReducer, type EditorCommand } from '../hooks/editorState.ts';
import { createEditorHandle, type WorkflowEditorHandle } from '../hooks/editorHandle.ts';
import { type EditorSelection } from '../hooks/editorNotifications.ts';
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
import type { ChangeMeta, ProposalOutcome } from '../changeset/types.ts';

export type FlowTheme = 'light' | 'dark';

/** A plausible sample value for a declared start-node input, based on its type (and name hints). */
function sampleValueForInput(input: { name: string; type?: string | null }): unknown {
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

/** A stable no-op change listener used when the host supplies none (or the editor is read-only). */
const ignoreChange = (): void => {};

export interface WorkflowEditorProps {
  workflow: Workflow;
  /**
   * Called with every committed revision. `meta.origin` tells host- and agent-made changes apart from the
   * user's; `meta.contentRevision` is the base revision for the next change set. Never called when
   * {@link readOnly} is true.
   */
  onChange?: (workflow: Workflow, meta: ChangeMeta) => void;
  /**
   * When true, the workflow is presented but cannot be changed: the palette and editing toolbar
   * actions are hidden, nodes/edges cannot be added, removed, moved or connected, the properties
   * panel is rendered read-only, mutating keyboard shortcuts are ignored and {@link onChange} is
   * never called. Simulation is hidden. Pan, zoom, selection, fit-view, validation and export
   * remain available. Defaults to false.
   */
  readOnly?: boolean;
  onValidationChange?: (problems: ValidationProblem[]) => void;
  theme?: FlowTheme;
  spi?: EditorSpi;
  /** Imperative handle for staging and applying change sets (React 19 ref prop). */
  ref?: Ref<WorkflowEditorHandle>;
  /** Called once for every proposal resolution: accepted, rejected, stale or withdrawn. */
  onProposalResolved?: (id: string, outcome: ProposalOutcome) => void;
  /** Called when the set of selected nodes/edges changes. */
  onSelectionChange?: (selection: EditorSelection) => void;
  /** Keep elements changed by the last applied change set highlighted. Defaults to true. */
  highlightApplied?: boolean;
}

function WorkflowEditorInner({
  workflow, onChange, readOnly = false, onValidationChange, theme = 'light', spi, ref, onProposalResolved, onSelectionChange,
  highlightApplied = true,
}: WorkflowEditorProps) {
  const { state, dispatch: rawDispatch } = useEditorState(workflow, readOnly ? ignoreChange : onChange ?? ignoreChange,
    { onProposalResolved, onSelectionChange });
  // In read-only mode every mutating command is dropped before it reaches the reducer.
  const dispatch = useCallback((command: EditorCommand) => {
    const allowed = readOnly ? readOnlyCommand(command) : command;
    if (allowed) rawDispatch(allowed);
  }, [readOnly, rawDispatch]);
  const { nodes, edges, selectedNodeId, selectedEdgeId, simulating: simActive, interactive } = state;
  const currentWorkflow = state.document;
  const semanticWorkflow = state.semanticDocument;
  const { screenToFlowPosition, fitView, getNodes } = useReactFlow();
  const canUndo = state.past.length > 0 && !simActive && !readOnly;
  const canRedo = state.future.length > 0 && !simActive && !readOnly;
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
  const interactivityEnabled = interactive && !simActive && !readOnly;
  const isResizing = useRef(false);

  const selectedNode = nodes.find(n => n.id === selectedNodeId);
  const selectedEdge = edges.find(e => e.id === selectedEdgeId);

  const builtInProblems = useMemo(
    () => validateWorkflow(semanticWorkflow),
    [semanticWorkflow],
  );

  const parallelAnalysis = useMemo(
    () => analyzeParallelRegions(semanticWorkflow),
    [semanticWorkflow],
  );

  const hostProblems = useHostValidation(semanticWorkflow, spi?.validate);

  const validationProblems = useMemo(
    () => [...builtInProblems, ...hostProblems],
    [builtInProblems, hostProblems],
  );

  const proposal = state.proposal;
  const previewBuiltInProblems = useMemo(
    () => (proposal ? validateWorkflow(proposal.preview) : []),
    [proposal],
  );
  const previewHostProblems = useHostValidation(proposal?.preview ?? semanticWorkflow, proposal ? spi?.validate : undefined);
  const proposalValidation = useMemo(
    () => validationText(validationDelta(validationProblems, [...previewBuiltInProblems, ...previewHostProblems])),
    [validationProblems, previewBuiltInProblems, previewHostProblems],
  );

  useEffect(() => {
    onValidationChange?.(validationProblems);
  }, [validationProblems, onValidationChange]);

  // The handle reads the latest committed state; dispatches update it eagerly with the same pure reducer so
  // consecutive handle calls (propose → apply) observe each other before React re-renders.
  const stateRef = useRef(state);
  const problemsRef = useRef(validationProblems);
  useLayoutEffect(() => {
    stateRef.current = state;
    problemsRef.current = validationProblems;
  }, [state, validationProblems]);
  useImperativeHandle(ref, () => createEditorHandle({
    state: () => stateRef.current,
    dispatch: (command) => {
      // Host document replacement bypasses the read-only filter; everything else obeys it.
      const allowed = command.type === 'import' ? command : readOnly ? readOnlyCommand(command) : command;
      if (!allowed) return;
      stateRef.current = editorReducer(stateRef.current, allowed);
      rawDispatch(allowed);
    },
    readOnly: () => readOnly,
    problems: () => problemsRef.current,
  }), [readOnly, rawDispatch]);

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

  // Ghost (proposed) nodes are not part of the editor state, so React Flow's measurements for them are kept
  // here; without them React Flow keeps the ghosts hidden.
  const [ghostSizes, setGhostSizes] = useState<Record<string, { width: number; height: number }>>({});
  const handleNodesChange = useCallback((changes: NodeChange<Node<FlowNodeData>>[]) => {
    const known = new Set(nodes.map(node => node.id));
    const ghostChanges = changes.filter(change => change.type === 'dimensions' && !known.has(change.id) && change.dimensions);
    if (ghostChanges.length) {
      setGhostSizes(previous => {
        const next = { ...previous };
        ghostChanges.forEach(change => {
          if (change.type === 'dimensions' && change.dimensions) next[change.id] = change.dimensions;
        });
        return next;
      });
    }
    const rest = changes.filter(change => !ghostChanges.includes(change));
    if (rest.length) dispatch({ type: 'nodesChange', changes: rest });
  }, [dispatch, nodes]);

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

  const onNodeClick = useCallback((_: React.MouseEvent, node: Node) => {
    dispatch({ type: 'select', nodeId: node.id });
  }, [dispatch]);

  const onEdgeClick = useCallback((_: React.MouseEvent, edge: Edge) => {
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

  const onEdgeDataChange = useCallback((id: string, dataUpdate: Record<string, unknown>) => {
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
      isComposing: event.nativeEvent.isComposing }, owned, textEditing, simActive, readOnly);
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
  }, [dispatch, nodes, edges, simActive, interactivityEnabled, state, readOnly]);

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
  // Simulation is not offered when read-only; leave it if the host switches to read-only mid-run.
  // Adjusted during render (not in an effect) so no frame shows a simulation in read-only mode.
  if (readOnly && simActive) {
    rawDispatch({ type: 'mode', simulating: false });
    if (simState) setSimState(null);
  }

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

  const overlay = useMemo(() => {
    const built = buildProposalOverlay(displayNodes, displayEdges, currentWorkflow, proposal,
      highlightApplied ? state.highlight : null);
    return { ...built, nodes: built.nodes.map(node => built.status?.nodes[node.id] === 'added' && ghostSizes[node.id]
      ? { ...node, measured: ghostSizes[node.id] } : node) };
  }, [displayNodes, displayEdges, currentWorkflow, proposal, highlightApplied, state.highlight, ghostSizes]);
  // Focus is tied to a proposal id so it resets automatically when the proposal changes.
  const [proposalFocus, setProposalFocus] = useState<{ proposalId: string; elementId: string } | null>(null);
  const focusedDetails = proposal && proposalFocus?.proposalId === proposal.changeSet.id
    ? proposalDetails(currentWorkflow, proposal.preview, proposalFocus.elementId) : null;
  const focusProposalElement = useCallback((id: string, kind: 'nodes' | 'edges') => {
    const changed = overlay.status && overlay.status[kind][id] && overlay.status[kind][id] !== 'unchanged';
    setProposalFocus(changed && proposal ? { proposalId: proposal.changeSet.id, elementId: id } : null);
    return overlay.status?.[kind][id] === 'added';
  }, [overlay.status, proposal]);
  const onCanvasNodeClick: typeof onNodeClick = useCallback((event, node) => {
    if (!focusProposalElement(node.id, 'nodes')) onNodeClick(event, node);
  }, [focusProposalElement, onNodeClick]);
  const onCanvasEdgeClick: typeof onEdgeClick = useCallback((event, edge) => {
    if (!focusProposalElement(edge.id, 'edges')) onEdgeClick(event, edge);
  }, [focusProposalElement, onEdgeClick]);

  return (
    <div ref={editorRootRef} className={`workflow-editor${readOnly ? ' workflow-editor--readonly' : ''}`}
      data-flow-theme={theme} data-read-only={readOnly || undefined}
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
      {!readOnly && <NodePalette />}
      <div className="workflow-editor__body">
        <div className={`workflow-editor__canvas${simActive ? ' workflow-editor__canvas--simulating' : ''}`}>
          <ReactFlow
            nodes={overlay.nodes}
            edges={overlay.edges}
            onNodesChange={handleNodesChange}
            onEdgesChange={handleEdgesChange}
            onConnect={onConnect}
            onDrop={onDrop}
            onDragOver={onDragOver}
            onNodeClick={onCanvasNodeClick}
            onEdgeClick={onCanvasEdgeClick}
            onPaneClick={onPaneClick}
            onNodeContextMenu={onNodeContextMenu}
            onNodeDragStop={onNodeDragStop}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            defaultEdgeOptions={{ type: 'conditional' }}
            deleteKeyCode={null}
            nodesDraggable={interactivityEnabled}
            nodesConnectable={interactivityEnabled}
            elementsSelectable={readOnly || interactivityEnabled}
            edgesReconnectable={interactivityEnabled}
            colorMode={theme}
            fitView
          >
            <Background />
            <Controls showInteractive={false}>
              {!readOnly && <ControlButton
                title="Toggle Interactivity"
                aria-label="Toggle Interactivity"
                disabled={simActive}
                onClick={() => dispatch({ type: 'mode', interactive: !interactive })}
              >
                {interactivityEnabled ? <LockOpenIcon /> : <LockIcon />}
              </ControlButton>}
            </Controls>
            <Panel position="top-right">
              <div className="workflow-editor__toolbar">
                {!readOnly && <>
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
                </>}
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
                {!readOnly && <Switch
                  id={simulateSwitchId}
                  className="workflow-editor__sim-switch"
                  label="Simulate"
                  aria-label="Simulate routing against a sample context"
                  isChecked={simActive}
                  onChange={toggleSim}
                />}
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
          {proposal && !readOnly && (
            <ProposalReviewBar
              proposal={proposal}
              counts={formatCounts(proposalCounts(overlay.status!))}
              validation={proposalValidation}
              details={focusedDetails}
              onAccept={() => dispatch({ type: 'acceptProposal' })}
              onReject={() => dispatch({ type: 'rejectProposal' })}
            />
          )}
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
            readOnly={readOnly}
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
