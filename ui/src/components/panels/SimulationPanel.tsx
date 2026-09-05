import { useState } from 'react';
import { PlayIcon, StepForwardIcon, FastForwardIcon, SyncAltIcon } from '@patternfly/react-icons';
import { type Workflow, type WorkflowNode } from '../../types/workflow.ts';
import { type SimState, type SimMock, type SimStatus } from '../../simulation/simulate.ts';
import { JsonCodeEditor } from '../common/JsonCodeEditor.tsx';
import { activeNodeIds, parkedNodes, branchPaths, type ParkedNode } from '../../utils/parallelView.ts';
import './SimulationPanel.css';

interface SimulationPanelProps {
  /** The workflow currently being edited/simulated (used to scaffold block forms). */
  workflow: Workflow;
  /** The current simulation state, or null before a run has started. */
  simState: SimState | null;
  /** Sample start-context JSON, controlled by the parent so it survives panel toggles. */
  contextText: string;
  onContextTextChange: (value: string) => void;
  /** Starts (or restarts) a run with the given, already-parsed start context. */
  onStart: (context: Record<string, unknown>) => void;
  /** Advances one node transition. */
  onStep: () => void;
  /** Runs forward until the simulation blocks, completes, or fails. */
  onRun: () => void;
  /** Clears the current run. */
  onReset: () => void;
  /** Delivers a mock output/event to a specific blocked node (by id) and continues. */
  onResume: (mock: SimMock, nodeId?: string) => void;
  /** Exits simulation mode entirely. */
  onClose: () => void;
  /** Selects + centers a node on the canvas. */
  onFocusNode: (nodeId: string) => void;
  /** Selects an edge on the canvas. */
  onFocusEdge: (edgeId: string) => void;
  /** Current panel width in pixels. When omitted, the CSS default width is used. */
  width?: number;
  /** Starts a drag-resize when the user presses the panel's resize handle. */
  onResizeStart?: (e: React.MouseEvent) => void;
}

const STATUS_LABEL: Record<SimStatus, string> = {
  running: 'Running',
  blocked: 'Blocked',
  completed: 'Completed',
  failed: 'Failed',
};

/**
 * Picks a sensible placeholder value for a declared output, based on its semantic type, so the
 * scaffold is valid JSON of the right shape rather than an empty string for every field. An
 * explicit author-supplied {@code defaultValue} is honored when present.
 */
function sampleValueForOutput(output: { type?: unknown; defaultValue?: unknown }): unknown {
  if (output.defaultValue !== undefined) {
    return output.defaultValue;
  }
  switch (output.type) {
    case 'number': return -1;
    case 'boolean': return false;
    case 'object': return {};
    case 'string':
    default: return '';
  }
}

/**
 * Builds a JSON scaffold for a blocking node's mock output, seeded from the node's declared
 * outputs (if any) so the author sees the expected shape with type-aware placeholder values.
 */
function scaffoldOutputs(node: WorkflowNode | undefined): string {
  const outputs = node?.config?.outputs;
  if (Array.isArray(outputs) && outputs.length > 0) {
    const obj: Record<string, unknown> = {};
    for (const output of outputs) {
      if (output && typeof (output as { name?: unknown }).name === 'string') {
        obj[(output as { name: string }).name] = sampleValueForOutput(output as { type?: unknown; defaultValue?: unknown });
      }
    }
    return JSON.stringify(obj, null, 2);
  }
  return '{\n  \n}';
}

/**
 * The right-hand panel that drives an interactive routing simulation: the author supplies a sample
 * start context, runs or steps the workflow, provides mock outputs where a node would block, and
 * sees the resulting status, evolving context, path taken, and any error tied to the offending
 * node/edge. All routing/condition semantics come from the pure {@code simulate}/{@code elEvaluator}
 * modules, which are pinned to the Java engine.
 */
export function SimulationPanel({
  workflow, simState, contextText, onContextTextChange,
  onStart, onStep, onRun, onReset, onResume, onClose,
  onFocusNode, onFocusEdge, width, onResizeStart,
}: SimulationPanelProps) {
  const [contextError, setContextError] = useState<string | null>(null);
  const [mockText, setMockText] = useState('{\n  \n}');
  const [mockError, setMockError] = useState<string | null>(null);
  const [seededFor, setSeededFor] = useState<string | undefined>(undefined);

  const nodeType = (nodeId: string) => workflow.nodes.find(n => n.id === nodeId)?.type;
  const parked: ParkedNode[] = simState
    ? parkedNodes(simState.activeBranches, simState.parkedBranchIds, nodeType)
    : [];
  const activeNodeList = simState
    ? [...activeNodeIds(simState.activeBranches, simState.parkedBranchIds)]
    : [];

  // The parked node the mock editor currently targets. Default to the first parked node; reset when
  // the current selection is no longer parked (adjusting state during render is React's recommended
  // pattern for resetting state on a derived "key" change).
  const [selectedParkedId, setSelectedParkedId] = useState<string | undefined>(undefined);
  const selectedParked =
    parked.find(p => p.nodeId === selectedParkedId) ?? parked[0];
  if (parked.length > 0 && selectedParked && selectedParked.nodeId !== selectedParkedId) {
    setSelectedParkedId(selectedParked.nodeId);
  }
  const selectedParkedNode = selectedParked
    ? workflow.nodes.find(n => n.id === selectedParked.nodeId)
    : undefined;

  // Re-scaffold the mock-output editor each time the simulation blocks at a new node. Adjusting
  // state during render (rather than in an effect) is React's recommended pattern for resetting
  // state on a "key" change, and avoids the cascading-render effect lint rule.
  const selectedParkedNodeId = selectedParked?.nodeId;
  if (selectedParkedNodeId && selectedParkedNodeId !== seededFor) {
    setSeededFor(selectedParkedNodeId);
    setMockText(scaffoldOutputs(selectedParkedNode));
    setMockError(null);
  }

  type ParseResult =
    | { ok: true; value: Record<string, unknown> }
    | { ok: false; error: string };

  const parseObject = (text: string): ParseResult => {
    let parsed: unknown;
    try {
      parsed = text.trim() === '' ? {} : JSON.parse(text);
    } catch (e) {
      return { ok: false, error: `Invalid JSON: ${(e as Error).message}` };
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { ok: false, error: 'Expected a JSON object' };
    }
    return { ok: true, value: parsed as Record<string, unknown> };
  };

  const handleStart = () => {
    const result = parseObject(contextText);
    if (!result.ok) {
      setContextError(result.error);
      return;
    }
    setContextError(null);
    onStart(result.value);
  };

  const handleContinue = () => {
    if (!selectedParked) return;
    const result = parseObject(mockText);
    if (!result.ok) {
      setMockError(result.error);
      return;
    }
    setMockError(null);
    onResume({ output: result.value }, selectedParked.nodeId);
  };

  const status = simState?.status;
  const canStep = status === 'running';

  return (
    <div className="simulation-panel" style={width ? { width } : undefined}>
      <div className="simulation-panel__resize-handle" onMouseDown={onResizeStart} />
      <div className="simulation-panel__header">
        <span>Simulation</span>
        <button className="simulation-panel__close" title="Exit simulation" onClick={onClose}>
          &times;
        </button>
      </div>

      <div className="simulation-panel__body">
        <div className="simulation-panel__field">
          <label>Sample start context (JSON)</label>
          <JsonCodeEditor
            value={contextText}
            onChange={onContextTextChange}
            minRows={6}
            ariaLabel="Sample start context (JSON)"
          />
          {contextError && <div className="simulation-panel__error-text">{contextError}</div>}
        </div>

        <div className="simulation-panel__controls">
          <button className="simulation-panel__primary" onClick={handleStart}>
            <PlayIcon /> {simState ? 'Restart' : 'Start'}
          </button>
          <button onClick={onStep} disabled={!canStep} title="Advance one step">
            <StepForwardIcon /> Step
          </button>
          <button onClick={onRun} disabled={!canStep} title="Run to next block or end">
            <FastForwardIcon /> Run
          </button>
          <button onClick={onReset} disabled={!simState} title="Clear the run">
            <SyncAltIcon /> Reset
          </button>
        </div>

        {simState && (
          <div className="simulation-panel__status">
            <span className={`simulation-panel__badge is-${simState.status}`}>
              {STATUS_LABEL[simState.status]}
            </span>
            {activeNodeList.map(nodeId => (
              <button
                key={nodeId}
                className="simulation-panel__link"
                onClick={() => onFocusNode(nodeId)}
              >
                {workflow.nodes.find(n => n.id === nodeId)?.name || nodeId}
              </button>
            ))}
          </div>
        )}

        {simState?.status === 'blocked' && selectedParked && (
          <div className="simulation-panel__block">
            {parked.length > 1 && (
              <select
                className="simulation-panel__block-select"
                value={selectedParked.nodeId}
                onChange={(e) => setSelectedParkedId(e.target.value)}
                aria-label="Select blocked node"
              >
                {parked.map(p => (
                  <option key={p.branchId} value={p.nodeId}>
                    {(workflow.nodes.find(n => n.id === p.nodeId)?.name || p.nodeId)} ({p.kind})
                    {p.branchId !== 'root' ? ` — ${p.branchId}` : ''}
                  </option>
                ))}
              </select>
            )}
            <div className="simulation-panel__block-title">
              Blocked at{' '}
              <button className="simulation-panel__link" onClick={() => onFocusNode(selectedParked.nodeId)}>
                {selectedParkedNode?.name || selectedParked.nodeId}
              </button>{' '}
              <span className="simulation-panel__kind">({selectedParked.kind})</span>
            </div>
            <label>Mock output — merged into context (JSON)</label>
            <JsonCodeEditor
              value={mockText}
              onChange={setMockText}
              minRows={5}
              ariaLabel="Mock output (JSON)"
            />
            {mockError && <div className="simulation-panel__error-text">{mockError}</div>}
            <button className="simulation-panel__primary" onClick={handleContinue}>
              Deliver &amp; continue
            </button>
          </div>
        )}

        {simState?.error && (
          <div className="simulation-panel__error">
            <div className="simulation-panel__error-title">Error</div>
            <div>{simState.error.message}</div>
            <div className="simulation-panel__error-actions">
              {simState.error.nodeId && (
                <button className="simulation-panel__link" onClick={() => onFocusNode(simState.error!.nodeId!)}>
                  Go to node
                </button>
              )}
              {simState.error.edgeId && (
                <button className="simulation-panel__link" onClick={() => onFocusEdge(simState.error!.edgeId!)}>
                  Go to edge
                </button>
              )}
            </div>
          </div>
        )}

        {simState && simState.history.length > 0 && (
          <div className="simulation-panel__field">
            <label>Path</label>
            {branchPaths(simState.history).map(bp => (
              <div key={bp.branchId} className="simulation-panel__branch-path">
                {bp.branchId !== 'root' && (
                  <div className="simulation-panel__branch-label">Branch {bp.branchId}</div>
                )}
                <ol className="simulation-panel__path">
                  {bp.nodeIds.map((nodeId, i) => (
                    <li key={`${nodeId}-${i}`}>
                      <button className="simulation-panel__link" onClick={() => onFocusNode(nodeId)}>
                        {workflow.nodes.find(n => n.id === nodeId)?.name || nodeId}
                      </button>
                    </li>
                  ))}
                </ol>
              </div>
            ))}
          </div>
        )}

        {simState && (
          <div className="simulation-panel__field">
            <label>Context</label>
            <JsonCodeEditor
              value={JSON.stringify(simState.context, null, 2)}
              readOnly
              minRows={4}
              ariaLabel="Current simulation context (read-only)"
            />
          </div>
        )}
      </div>
    </div>
  );
}
