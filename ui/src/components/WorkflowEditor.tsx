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
import { type Workflow, type WorkflowDefaults } from '../types/workflow.ts';
import { type ValidationProblem } from '../types/validation.ts';
import { type EditorSpi, type FlowContext, type FlowTarget } from '../types/spi.ts';
import { type FlowNodeData } from '../utils/conversion.ts';
import { generateNodeId, generateEdgeId } from '../utils/id.ts';
import { parseWorkflow, downloadWorkflowJson, workflowFileName } from '../utils/workflowIo.ts';
import { exportCanvasImage } from '../utils/exportImage.ts';
import { simNodeClass, activeNodeIds, parallelRole } from '../utils/parallelView.ts';
import { validateWorkflow } from '../validation/validateWorkflow.ts';
import { analyzeParallelRegions } from '../simulation/parallelRegions.ts';
import { useHostValidation } from '../hooks/useHostValidation.ts';
import { useActionTypeCatalog } from '../hooks/useActionTypeCatalog.ts';
import { unresolvedActionTypeIds } from '../utils/unresolvedActionTypes.ts';
import { actionAppearanceByNodeId } from '../utils/actionAppearance.ts';
import { retryBadgesByNodeId } from '../utils/retryPolicy.ts';
import {
  buildProposalOverlay, formatCounts, proposalCounts, proposalDetails, splitGhostChanges, validationText, type GhostSizes,
} from '../changeset/proposalOverlay.ts';
import { validationDelta } from '../changeset/validationDelta.ts';
import { ProposalReviewBar } from './panels/ProposalReviewBar.tsx';
import { nodeTypes } from './nodes/nodeTypes.ts';
import { edgeTypes } from './edges/edgeTypes.ts';
import { NodePalette } from './panels/NodePalette.tsx';
import { PropertiesPanel } from './panels/PropertiesPanel.tsx';
import { ProblemsPanel } from './panels/ProblemsPanel.tsx';
import { SimulationPanel } from './panels/SimulationPanel.tsx';
import { ContextMenu } from './ContextMenu.tsx';
import { PropertiesDialog } from './PropertiesDialog.tsx';
import { selectOnlyChanges } from '../utils/selectOnly.ts';
import { buildFlowContext, menuTarget, type MenuSubject } from '../contextActions/flowContext.ts';
import { builtInItems, resolveMenuItems, type BuiltInHandlers, type MenuEntry } from '../contextActions/menuItems.ts';
import { useEditorState } from '../hooks/useEditorState.ts';
import { editorShortcut } from '../hooks/editorShortcuts.ts';
import { readOnlyCommand } from '../hooks/editorReadOnly.ts';
import { editorReducer, type EditorCommand } from '../hooks/editorState.ts';
import { createEditorHandle, type WorkflowEditorHandle } from '../hooks/editorHandle.ts';
import { selectionOf, type EditorSelection } from '../hooks/editorNotifications.ts';
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
import type { AppliedChangeLayout } from '../changeset/appliedLayout.ts';
import type { ChangeMeta, ProposalOutcome } from '../changeset/types.ts';

export type FlowTheme = 'light' | 'dark';

/**
 * A plausible sample value for a declared start-node input: its authored default when present,
 * otherwise a value based on its type (and name hints).
 */
function sampleValueForInput(input: { name: string; type?: string | null; defaultValue?: unknown }): unknown {
  if (input.defaultValue !== undefined) return input.defaultValue;
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

/** Editor features a host can switch off. Omitted keys stay enabled; switched-off controls are hidden. */
export interface EditorFeatures {
  /** Import button (load a workflow from a JSON file). */
  import?: boolean;
  /** Export button (save the workflow as a JSON file). */
  export?: boolean;
  /** Image button (export the canvas as a PNG image). */
  image?: boolean;
  /** Simulate switch and the simulation panel. Switching it off during a run ends the simulation. */
  simulate?: boolean;
}

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
  /**
   * Select the elements added or modified by an applied change set (or accepted proposal) on the canvas,
   * replacing the current selection. Defaults to true.
   */
  highlightApplied?: boolean;
  /**
   * How change sets from `propose`/`apply` are laid out. `'place'` (default) positions only new nodes, next to
   * their neighbours, and never moves existing ones. `'tidy'` auto-lays-out the whole graph whenever a change
   * set adds, removes or re-points nodes or edges; the tidy is shown in the proposal preview and is part of the
   * same undo step. Hosts can expose this as a user preference.
   */
  appliedChangeLayout?: AppliedChangeLayout;
  /**
   * Where node and edge properties are edited. `'panel'` (default) shows them in the right-hand side panel.
   * `'dialog'` removes the side panel (except while simulating) and edits properties in a modal dialog,
   * opened by double-clicking a node or edge or by its context menu's Properties item. Edits in the dialog
   * are live, exactly as in the panel.
   */
  propertiesDisplay?: 'panel' | 'dialog';
  /**
   * Switches individual editor features off, for example `{ import: false, simulate: false }`. Every feature
   * is enabled unless set to `false`. Read-only mode still hides Import and Simulate regardless.
   */
  features?: EditorFeatures;
}

function WorkflowEditorInner({
  workflow, onChange, readOnly = false, onValidationChange, theme = 'light', spi, ref, onProposalResolved, onSelectionChange,
  highlightApplied = true,
  appliedChangeLayout = 'place',
  propertiesDisplay = 'panel',
  features,
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
  const menuOpenRef = useRef(false);
  const [menu, setMenu] = useState<{
    entries: MenuEntry[];
    position: { x: number; y: number };
    bounds: { left: number; top: number; right: number; bottom: number };
    returnFocus: HTMLElement | SVGElement | null;
  } | null>(null);
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
  const actionTypeCatalog = useActionTypeCatalog(spi?.actionTypes);

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
  const revealRef = useRef<((target: { nodeId: string } | { edgeId: string } | null, center: boolean) => void) | null>(null);
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
    layout: () => appliedChangeLayout,
    selectApplied: () => highlightApplied,
    reveal: (target, center) => revealRef.current?.(target, center),
  }), [readOnly, rawDispatch, appliedChangeLayout, highlightApplied]);

  const unresolvedIds = useMemo(() => unresolvedActionTypeIds(semanticWorkflow, actionTypeCatalog),
    [semanticWorkflow, actionTypeCatalog]);
  const appearances = useMemo(() => actionAppearanceByNodeId(semanticWorkflow.nodes, actionTypeCatalog),
    [semanticWorkflow, actionTypeCatalog]);
  const retryBadges = useMemo(() => retryBadgesByNodeId(semanticWorkflow.nodes, semanticWorkflow.defaults),
    [semanticWorkflow]);

  const nodesWithValidation = useMemo(() => {
    if (!validationProblems?.length && !parallelAnalysis && !unresolvedIds.size && !appearances.size
      && !retryBadges.size) return nodes;
    return nodes.map(node => {
      const problems = validationProblems.filter(p => p.nodeId === node.id);
      const role = parallelRole(node.id, parallelAnalysis);
      const unresolved = unresolvedIds.has(node.id)
        ? String((node.data.config as { actionType?: unknown }).actionType) : undefined;
      const appearance = appearances.get(node.id);
      const retryBadge = retryBadges.get(node.id);
      return (problems.length || role || unresolved || appearance || retryBadge) ? {
        ...node,
        data: {
          ...node.data,
          validationProblems: problems.length ? problems : undefined,
          parallelRole: role,
          unresolvedActionType: unresolved,
          actionAppearance: appearance,
          retryBadge,
        },
      } : node;
    });
  }, [nodes, validationProblems, parallelAnalysis, unresolvedIds, appearances, retryBadges]);

  const selectedNodeProblems = useMemo(
    () => (selectedNodeId ? validationProblems.filter(p => p.nodeId === selectedNodeId) : []),
    [validationProblems, selectedNodeId],
  );

  // Ghost (proposed) nodes are not part of the editor state, so React Flow's measurements for them are kept
  // here, keyed by proposal so a new proposal never reuses an old one's sizes; without them React Flow keeps
  // the ghosts hidden.
  const [ghostSizes, setGhostSizes] = useState<{ proposalId: string; sizes: GhostSizes } | null>(null);
  const proposalId = state.proposal?.changeSet.id;
  const handleNodesChange = useCallback((changes: NodeChange<Node<FlowNodeData>>[]) => {
    const { ghostSizes: measured, rest } = splitGhostChanges(changes, new Set(nodes.map(node => node.id)));
    if (proposalId && Object.keys(measured).length) {
      setGhostSizes(previous => ({ proposalId,
        sizes: { ...(previous?.proposalId === proposalId ? previous.sizes : {}), ...measured } }));
    }
    if (rest.length) dispatch({ type: 'nodesChange', changes: rest });
  }, [dispatch, nodes, proposalId]);

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
    menuOpenRef.current = false;
    setMenu(null);
  }, [dispatch]);

  // Latest state, read at call time by menu handlers and the Problems probe so they never act on a stale copy.
  const latestStateRef = useRef(state);
  useLayoutEffect(() => {
    latestStateRef.current = state;
  }, [state]);

  // --- Properties dialog (propertiesDisplay === 'dialog') -------------------
  // Nodes are tracked by their stable key so the dialog stays open while the user edits the node's ID.
  const dialogMode = propertiesDisplay === 'dialog';
  const [dialogTarget, setDialogTarget] = useState<{ kind: 'node'; key: string } | { kind: 'edge'; edgeId: string } | null>(null);
  const openProperties = useCallback((target: { kind: 'node'; nodeId: string } | { kind: 'edge'; edgeId: string }) => {
    const current = latestStateRef.current;
    if (target.kind === 'node') {
      const key = current.nodeKeys[target.nodeId];
      if (!key) return;
      dispatch({ type: 'select', nodeId: target.nodeId });
      setDialogTarget({ kind: 'node', key });
    } else if (current.document.edges.some(edge => edge.id === target.edgeId)) {
      dispatch({ type: 'select', edgeId: target.edgeId });
      setDialogTarget({ kind: 'edge', edgeId: target.edgeId });
    }
  }, [dispatch]);

  const builtInHandlers = useMemo<BuiltInHandlers>(() => ({
    clone: nodeId => {
      const node = latestStateRef.current.document.nodes.find(candidate => candidate.id === nodeId);
      if (node) dispatch({ type: 'cloneNode', id: nodeId, newId: generateNodeId(node.type) });
    },
    deleteElements: (nodeIds, edgeIds) => deleteWithEditorFocus(latestStateRef.current,
      { type: 'delete', nodeIds, edgeIds }, editorRootRef.current, dispatch),
    removeDefaultFlag: edgeId => dispatch({ type: 'edgeData', id: edgeId, data: { isDefault: false } }),
    ...(dialogMode ? { openProperties } : {}),
  }), [dispatch, dialogMode, openProperties]);

  /** Opens a context menu for a subject; returns false (and opens nothing) when there is nothing to show. */
  const openMenu = useCallback((subject: MenuSubject, screenPosition: { x: number; y: number },
    returnFocus: HTMLElement | SVGElement | null): boolean => {
    if (simActive) return false;
    const target = menuTarget(subject, selectionOf(state));
    const context = buildFlowContext(state, target, validationProblems, readOnly, screenPosition);
    const entries = resolveMenuItems(builtInItems(target, builtInHandlers, interactivityEnabled),
      spi?.contextActions, context);
    if (!entries.length) return false;
    const box = editorRootRef.current?.getBoundingClientRect();
    // Keep the menu inside both the editor and the browser viewport.
    const bounds = {
      left: Math.max(0, box?.left ?? 0), top: Math.max(0, box?.top ?? 0),
      right: Math.min(window.innerWidth, box?.right ?? window.innerWidth),
      bottom: Math.min(window.innerHeight, box?.bottom ?? window.innerHeight),
    };
    menuOpenRef.current = true;
    setMenu({ entries, position: { ...screenPosition }, bounds, returnFocus });
    return true;
  }, [simActive, state, validationProblems, readOnly, interactivityEnabled, builtInHandlers, spi]);

  const onProblemMenu = useCallback((problem: ValidationProblem, screenPosition: { x: number; y: number },
    opener: HTMLElement): boolean => {
    if (menuOpenRef.current) return true;
    return openMenu({ kind: 'problem', problem }, screenPosition, opener);
  }, [openMenu]);

  // Probes the host (silently) to decide whether a row's actions button is enabled. Cached per document,
  // problems and mode only; selection is read from the latest state (the probe is advisory). All rows share
  // one lazily built base context, so the document is cloned at most once per cache.
  const contextActions = spi?.contextActions;
  const problemDocument = state.document;
  const problemRevision = state.contentRevision;
  const problemMenuEnabled = useMemo(() => {
    // Without host actions only built-in quick fixes can enable a row; they are cheap, so skip the cache.
    if (!contextActions) return (problem: ValidationProblem): boolean => !simActive
      && builtInItems({ kind: 'problem', problem }, builtInHandlers, interactivityEnabled).length > 0;
    const cache = new Map<ValidationProblem, boolean>();
    let base: Omit<FlowContext, 'target'> | undefined;
    return (problem: ValidationProblem): boolean => {
      if (simActive) return false;
      if (!cache.has(problem)) {
        base ??= {
          workflow: structuredClone(problemDocument),
          contentRevision: problemRevision,
          selection: selectionOf(latestStateRef.current),
          problems: structuredClone(validationProblems),
          readOnly,
          screenPosition: { x: 0, y: 0 },
        };
        const target: FlowTarget = { kind: 'problem', problem: structuredClone(problem) };
        const context: FlowContext = { ...base, target };
        cache.set(problem, resolveMenuItems(builtInItems(target, builtInHandlers, interactivityEnabled),
          contextActions, context, () => {}).length > 0);
      }
      return cache.get(problem)!;
    };
  }, [contextActions, simActive, problemDocument, problemRevision, validationProblems, readOnly, builtInHandlers,
    interactivityEnabled]);

  const onNodeContextMenu = useCallback((event: React.MouseEvent, node: Node<FlowNodeData>) => {
    if (menuOpenRef.current) { event.preventDefault(); return; }
    const opener = event.currentTarget instanceof HTMLElement ? event.currentTarget : null;
    if (openMenu({ kind: 'node', nodeId: node.id }, { x: event.clientX, y: event.clientY }, opener)) {
      event.preventDefault();
    }
  }, [openMenu]);

  const onNodeDoubleClick = useCallback((_event: React.MouseEvent, node: Node) => {
    if (dialogMode && !simActive) openProperties({ kind: 'node', nodeId: node.id });
  }, [dialogMode, simActive, openProperties]);

  const onEdgeDoubleClick = useCallback((_event: React.MouseEvent, edge: Edge) => {
    if (dialogMode && !simActive) openProperties({ kind: 'edge', edgeId: edge.id });
  }, [dialogMode, simActive, openProperties]);

  const onEdgeContextMenu = useCallback((event: React.MouseEvent, edge: Edge) => {
    if (menuOpenRef.current) { event.preventDefault(); return; }
    const opener = event.currentTarget instanceof HTMLElement || event.currentTarget instanceof SVGElement
      ? event.currentTarget : null;
    if (openMenu({ kind: 'edge', edgeId: edge.id }, { x: event.clientX, y: event.clientY }, opener)) {
      event.preventDefault();
    }
  }, [openMenu]);

  const onPaneContextMenu = useCallback((event: MouseEvent | React.MouseEvent<Element, MouseEvent>) => {
    if (menuOpenRef.current) { event.preventDefault(); return; }
    const screenPosition = { x: event.clientX, y: event.clientY };
    if (openMenu({ kind: 'canvas', flowPosition: screenToFlowPosition(screenPosition) }, screenPosition,
      editorRootRef.current)) {
      event.preventDefault();
    }
  }, [openMenu, screenToFlowPosition]);

  // Right-click on the box-selection rectangle: target the selection through its first node.
  const onSelectionContextMenu = useCallback((event: React.MouseEvent, selected: Node[]) => {
    if (menuOpenRef.current) { event.preventDefault(); return; }
    if (selected.length && openMenu({ kind: 'node', nodeId: selected[0].id },
      { x: event.clientX, y: event.clientY }, editorRootRef.current)) {
      event.preventDefault();
    }
  }, [openMenu]);

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

  const onWorkflowDefaultsChange = useCallback((defaults: WorkflowDefaults | undefined) => {
    dispatch({ type: 'defaults', defaults });
  }, [dispatch]);

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
    if (owned && !textEditing && (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10'))) {
      const element = target?.closest<HTMLElement | SVGElement>('.react-flow__node[data-id], .react-flow__edge[data-id]');
      const id = element?.getAttribute('data-id');
      if (element && id) {
        const box = element.getBoundingClientRect();
        const subject: MenuSubject = element.classList.contains('react-flow__node')
          ? { kind: 'node', nodeId: id } : { kind: 'edge', edgeId: id };
        if (openMenu(subject, { x: box.left + box.width / 2, y: box.top + box.height / 2 }, element)) {
          event.preventDefault();
          event.stopPropagation();
          return;
        }
      }
    }
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
  }, [dispatch, nodes, edges, simActive, interactivityEnabled, state, readOnly, openMenu]);

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

  // Makes one element the visible (highlighted) canvas selection and optionally centers it. Shared by the
  // Problems panel and the handle's `select`; reads the latest canvas so handle calls never see a stale copy.
  const revealOnCanvas = useCallback((target: { nodeId: string } | { edgeId: string } | null, center: boolean) => {
    const { nodes: canvasNodes, edges: canvasEdges } = stateRef.current;
    const { nodeChanges, edgeChanges } = selectOnlyChanges(canvasNodes, canvasEdges, target ?? { nodeId: '' });
    if (nodeChanges.length) dispatch({ type: 'nodesChange', changes: nodeChanges });
    if (edgeChanges.length) dispatch({ type: 'edgesChange', changes: edgeChanges });
    if (!target || !center) return;
    if ('nodeId' in target) {
      const node = canvasNodes.find(n => n.id === target.nodeId);
      if (node) fitView({ nodes: [node], duration: 300 });
    } else {
      // Center on the edge by fitting both of its endpoints into view.
      const edge = canvasEdges.find(e => e.id === target.edgeId);
      const ends = edge ? canvasNodes.filter(n => n.id === edge.source || n.id === edge.target) : [];
      if (ends.length) fitView({ nodes: ends, duration: 300 });
    }
  }, [fitView, dispatch]);
  useLayoutEffect(() => {
    revealRef.current = revealOnCanvas;
  }, [revealOnCanvas]);

  const onProblemClick = useCallback((problem: ValidationProblem) => {
    if (!problem.nodeId && !problem.edgeId) return;
    const target = problem.nodeId ? { nodeId: problem.nodeId } : { edgeId: problem.edgeId! };
    dispatch({ type: 'select', ...target });
    revealOnCanvas(target, true);
  }, [revealOnCanvas, dispatch]);

  // --- Simulation ---------------------------------------------------------
  // Simulation is not offered when read-only or when the host switches the feature off; leave it if either
  // happens mid-run. Adjusted during render (not in an effect) so no frame shows a simulation it hides.
  const canImport = features?.import !== false;
  const canExport = features?.export !== false;
  const canExportImage = features?.image !== false;
  const canSimulate = features?.simulate !== false;
  if ((readOnly || !canSimulate) && simActive) {
    rawDispatch({ type: 'mode', simulating: false });
    if (simState) setSimState(null);
  }
  // Simulation can also end outside the toggle (a host `apply`, `propose` or `replace`); drop the finished run.
  if (!simActive && simState) setSimState(null);

  // The properties dialog follows its element (by stable key for nodes, so ID edits keep it open) and closes
  // when the element disappears (undo, deletion, an applied change set) or simulation starts.
  const dialogNodeId = dialogTarget?.kind === 'node'
    ? Object.keys(state.nodeKeys).find(id => state.nodeKeys[id] === dialogTarget.key) : undefined;
  const dialogNode = dialogNodeId ? nodes.find(node => node.id === dialogNodeId) : undefined;
  const dialogEdge = dialogTarget?.kind === 'edge' ? edges.find(edge => edge.id === dialogTarget.edgeId) : undefined;
  if (dialogTarget && (!dialogMode || simActive || (!dialogNode && !dialogEdge))) setDialogTarget(null);
  const nodeName = (id: string) => nodes.find(node => node.id === id)?.data.name ?? id;
  const dialogTitle = dialogNode
    ? `${dialogNode.data.nodeType.split('-').map(part => part.charAt(0).toUpperCase() + part.slice(1)).join(' ')}: ${dialogNode.data.name}`
    : dialogEdge ? `Edge from ${nodeName(dialogEdge.source)} to ${nodeName(dialogEdge.target)}` : '';

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
    menuOpenRef.current = false;
    setMenu(null);
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
    const built = buildProposalOverlay(displayNodes, displayEdges, currentWorkflow, proposal);
    const sizes = proposal && ghostSizes?.proposalId === proposal.changeSet.id ? ghostSizes.sizes : {};
    return { ...built, nodes: built.nodes.map(node => built.status?.nodes[node.id] === 'added' && sizes[node.id]
      ? { ...node, measured: sizes[node.id] } : node) };
  }, [displayNodes, displayEdges, currentWorkflow, proposal, ghostSizes]);
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
            onNodeDoubleClick={onNodeDoubleClick}
            onEdgeDoubleClick={onEdgeDoubleClick}
            onEdgeContextMenu={onEdgeContextMenu}
            onPaneContextMenu={onPaneContextMenu}
            onSelectionContextMenu={onSelectionContextMenu}
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
                {canImport && <button title="Import workflow from a JSON file" disabled={simActive} onClick={handleImportClick}>
                  <UploadIcon /> Import
                </button>}
                </>}
                {canExport && <button title="Export workflow to a JSON file" onClick={handleExportJson}>
                  <DownloadIcon /> Export
                </button>}
                {canExportImage && <button title="Export the canvas as a PNG image" onClick={handleExportImage}>
                  <ImageIcon /> Image
                </button>}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="application/json,.json"
                  style={{ display: 'none' }}
                  onChange={onImportFileChange}
                />
                {!readOnly && canSimulate && <Switch
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
            {proposal && !readOnly && (
              <Panel position="bottom-center">
                <ProposalReviewBar
                  proposal={proposal}
                  counts={formatCounts(proposalCounts(overlay.status!))}
                  validation={proposalValidation}
                  details={focusedDetails}
                  onAccept={() => dispatch({ type: 'acceptProposal', selectApplied: highlightApplied })}
                  onReject={() => dispatch({ type: 'rejectProposal' })}
                />
              </Panel>
            )}
          </ReactFlow>
          {menu && (
            <ContextMenu entries={menu.entries} position={menu.position} bounds={menu.bounds}
              returnFocus={menu.returnFocus} onClose={() => { menuOpenRef.current = false; setMenu(null); }} />
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
        ) : !dialogMode && (
          <PropertiesPanel
            actionTypeCatalog={actionTypeCatalog}
            draftIdentity={`${selectedNodeId ? state.nodeKeys[selectedNodeId] : ''}:${state.draftReset}`}
            selectedNode={selectedNode}
            selectedEdge={selectedEdge}
            nodeProblems={selectedNodeProblems}
            onNodeChange={onNodeDataChange}
            onNodeIdChange={onNodeIdChange}
            onEdgeChange={onEdgeDataChange}
            workflowDefaults={state.document.defaults}
            onWorkflowDefaultsChange={onWorkflowDefaultsChange}
            spi={spi}
            readOnly={readOnly}
            sampleContext={sampleContext}
            width={panelWidth}
            onResizeStart={onResizeStart}
          />
        )}
      </div>
      {(dialogNode || dialogEdge) && (
        <PropertiesDialog title={dialogTitle} theme={theme}
          onClose={() => { setDialogTarget(null); editorRootRef.current?.focus({ preventScroll: true }); }}>
          <PropertiesPanel
            embedded
            actionTypeCatalog={actionTypeCatalog}
            draftIdentity={`${dialogNode ? state.nodeKeys[dialogNode.id] : dialogEdge?.id ?? ''}:${state.draftReset}`}
            selectedNode={dialogNode}
            selectedEdge={dialogNode ? undefined : dialogEdge}
            nodeProblems={dialogNode ? validationProblems.filter(problem => problem.nodeId === dialogNode.id) : []}
            onNodeChange={onNodeDataChange}
            onNodeIdChange={onNodeIdChange}
            onEdgeChange={onEdgeDataChange}
            workflowDefaults={state.document.defaults}
            onWorkflowDefaultsChange={onWorkflowDefaultsChange}
            spi={spi}
            readOnly={readOnly}
            sampleContext={sampleContext}
          />
        </PropertiesDialog>
      )}
      <ProblemsPanel problems={validationProblems} onProblemClick={onProblemClick} onProblemMenu={onProblemMenu} problemMenuEnabled={problemMenuEnabled}
        showDisabledProblemMenus={!!contextActions} />
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
