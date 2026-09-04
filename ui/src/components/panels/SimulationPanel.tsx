import { useState } from 'react';
import { PlayIcon, StepForwardIcon, FastForwardIcon, SyncAltIcon } from '@patternfly/react-icons';
import { type Workflow, type WorkflowNode } from '../../types/workflow.ts';
import { type SimState, type SimMock, type SimStatus } from '../../simulation/simulate.ts';
import { JsonCodeEditor } from '../common/JsonCodeEditor.tsx';
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
  /** Delivers a mock output/event to a blocked node and continues. */
  onResume: (mock: SimMock) => void;
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
 * Builds a JSON scaffold for a blocking node's mock output, seeded from the node's declared
 * outputs (if any) so the author sees the expected shape.
 */
function scaffoldOutputs(node: WorkflowNode | undefined): string {
  const outputs = node?.config?.outputs;
  if (Array.isArray(outputs) && outputs.length > 0) {
    const obj: Record<string, unknown> = {};
    for (const output of outputs) {
      if (output && typeof (output as { name?: unknown }).name === 'string') {
        obj[(output as { name: string }).name] = '';
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

  const blockedNode = simState?.blockedOn
    ? workflow.nodes.find(n => n.id === simState.blockedOn!.nodeId)
    : undefined;
  const blockedNodeId = simState?.blockedOn?.nodeId;

  // Re-scaffold the mock-output editor each time the simulation blocks at a new node. Adjusting
  // state during render (rather than in an effect) is React's recommended pattern for resetting
  // state on a "key" change, and avoids the cascading-render effect lint rule.
  if (blockedNodeId && blockedNodeId !== seededFor) {
    setSeededFor(blockedNodeId);
    setMockText(scaffoldOutputs(blockedNode));
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
    const result = parseObject(mockText);
    if (!result.ok) {
      setMockError(result.error);
      return;
    }
    setMockError(null);
    onResume({ output: result.value });
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
            {simState.currentNodeId && (
              <button className="simulation-panel__link" onClick={() => onFocusNode(simState.currentNodeId)}>
                at {workflow.nodes.find(n => n.id === simState.currentNodeId)?.name || simState.currentNodeId}
              </button>
            )}
          </div>
        )}

        {simState?.status === 'blocked' && simState.blockedOn && (
          <div className="simulation-panel__block">
            <div className="simulation-panel__block-title">
              Blocked at{' '}
              <button className="simulation-panel__link" onClick={() => onFocusNode(simState.blockedOn!.nodeId)}>
                {blockedNode?.name || simState.blockedOn.nodeId}
              </button>{' '}
              <span className="simulation-panel__kind">({simState.blockedOn.kind})</span>
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

        {simState && simState.visitedNodeIds.length > 0 && (
          <div className="simulation-panel__field">
            <label>Path</label>
            <ol className="simulation-panel__path">
              {simState.visitedNodeIds.map((nodeId, i) => (
                <li key={`${nodeId}-${i}`}>
                  <button className="simulation-panel__link" onClick={() => onFocusNode(nodeId)}>
                    {workflow.nodes.find(n => n.id === nodeId)?.name || nodeId}
                  </button>
                </li>
              ))}
            </ol>
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
