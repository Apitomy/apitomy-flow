import { useState, useEffect, useMemo, useRef } from 'react';
import { type Node, type Edge } from '@xyflow/react';
import {
  Select,
  SelectOption,
  SelectList,
  MenuToggle,
  TextInputGroup,
  TextInputGroupMain,
  TextInputGroupUtilities,
  Button,
} from '@patternfly/react-core';
import { TimesIcon } from '@patternfly/react-icons';
import { type FlowNodeData } from '../../utils/conversion.ts';
import { type EditorSpi } from '../../types/spi.ts';
import { type ActionTypeDescriptor } from '../../types/spi.ts';
import { type HumanTaskOutput, type OutputOption, type OutputWidget } from '../../types/workflow.ts';
import { type ValidationProblem } from '../../types/validation.ts';
import { mapToPairs, pairsToMap, duplicateKeys, nextPairId, type KeyValuePair } from '../../utils/mapInputs.ts';
import { evaluateCondition, ElEvaluationError } from '../../simulation/elEvaluator.ts';
import { JsonCodeEditor } from '../common/JsonCodeEditor.tsx';
import './PropertiesPanel.css';

interface PropertiesPanelProps {
  selectedNode?: Node<FlowNodeData>;
  selectedEdge?: Edge;
  nodeProblems?: ValidationProblem[];
  onNodeChange: (id: string, data: Partial<FlowNodeData>) => void;
  onNodeIdChange: (oldId: string, newId: string) => void;
  onEdgeChange: (id: string, data: Record<string, any>) => void;
  spi?: EditorSpi;
  /** A sample context used to seed the inline "Test condition" affordance. */
  sampleContext?: Record<string, unknown>;
  /** Current panel width in pixels. When omitted, the CSS default width is used. */
  width?: number;
  /** Starts a drag-resize when the user presses the panel's resize handle. */
  onResizeStart?: (e: React.MouseEvent) => void;
}

/**
 * Lists the validation problems for the selected node (errors first) at the top
 * of the properties panel, so the reader can see exactly what is wrong with the
 * node they are editing.
 */
function NodeProblems({ problems }: { problems: ValidationProblem[] }) {
  if (problems.length === 0) return null;
  const sorted = [...problems].sort((a, b) =>
    a.severity === b.severity ? 0 : a.severity === 'error' ? -1 : 1,
  );
  return (
    <div className="properties-panel__problems">
      <ul className="properties-panel__problems-list">
        {sorted.map((p, i) => (
          <li key={`${p.code}-${i}`} className="properties-panel__problems-item">
            <span className={p.severity === 'error'
              ? 'properties-panel__problems-severity-error'
              : 'properties-panel__problems-severity-warning'}>
              {p.severity === 'error' ? 'E' : 'W'}
            </span>
            <span className="properties-panel__problems-body">
              <span className="properties-panel__problems-message">{p.message}</span>
              <span className="properties-panel__problems-code">{p.code}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function useActionTypes(spi?: EditorSpi): { actionTypes: ActionTypeDescriptor[]; loading: boolean } {
  const provider = spi?.actionTypes;
  const isAsync = typeof provider === 'function';

  const staticTypes = useMemo(
    () => (Array.isArray(provider) ? provider : []),
    [provider],
  );

  const LOADING_SENTINEL: ActionTypeDescriptor[] = useMemo(() => [], []);
  const [asyncTypes, setAsyncTypes] = useState<ActionTypeDescriptor[]>(LOADING_SENTINEL);

  useEffect(() => {
    if (!isAsync) return;
    let cancelled = false;
    (provider as () => Promise<ActionTypeDescriptor[]>)().then(
      (result) => { if (!cancelled) setAsyncTypes(result); },
      () => { if (!cancelled) setAsyncTypes([]); },
    );
    return () => { cancelled = true; };
  }, [provider, isAsync]);

  if (!isAsync) return { actionTypes: staticTypes, loading: false };
  return { actionTypes: asyncTypes, loading: asyncTypes === LOADING_SENTINEL };
}

const OUTPUT_WIDGETS: OutputWidget[] = ['text', 'textarea', 'select'];

/**
 * Editor for a select widget's `options` list — a repeatable label/value pair editor shown only
 * when a human-task output uses `widget: 'select'`.
 */
function OptionsEditor({ options, onChange }: {
  options: OutputOption[];
  onChange: (options: OutputOption[]) => void;
}) {
  return (
    <div className="properties-panel__output-field">
      <label>Options</label>
      <div className="properties-panel__options-list">
        {options.map((opt, i) => (
          <div key={i} className="properties-panel__option-row">
            <input
              type="text"
              value={opt.label}
              placeholder="Label"
              onChange={(e) => onChange(options.map((o, j) => j === i ? { ...o, label: e.target.value } : o))}
            />
            <input
              type="text"
              value={opt.value}
              placeholder="Value"
              onChange={(e) => onChange(options.map((o, j) => j === i ? { ...o, value: e.target.value } : o))}
            />
            <button
              className="properties-panel__match-remove"
              title="Remove option"
              onClick={() => onChange(options.filter((_, j) => j !== i))}
            >
              &times;
            </button>
          </div>
        ))}
        <button
          className="properties-panel__match-add"
          onClick={() => onChange([...options, { label: '', value: '' }])}
        >
          + Add option
        </button>
      </div>
    </div>
  );
}

/**
 * Type-aware editor for a human-task output's `defaultValue`. Renders the control appropriate to the
 * output's semantic type (and to a `select` widget), storing a value that matches the declared type.
 */
function DefaultValueEditor({ output, onChange }: {
  output: HumanTaskOutput;
  onChange: (value: unknown) => void;
}) {
  const type = output.type ?? 'string';
  if (type === 'boolean') {
    return (
      <label className="properties-panel__input-required">
        <input
          type="checkbox"
          checked={output.defaultValue === true}
          onChange={(e) => onChange(e.target.checked ? true : undefined)}
        />
        Default checked
      </label>
    );
  }
  if (type === 'number') {
    return (
      <input
        type="number"
        value={typeof output.defaultValue === 'number' ? output.defaultValue : ''}
        onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))}
      />
    );
  }
  if (type === 'string' && output.widget === 'select') {
    return (
      <select
        value={typeof output.defaultValue === 'string' ? output.defaultValue : ''}
        onChange={(e) => onChange(e.target.value || undefined)}
      >
        <option value="">(none)</option>
        {(output.options ?? []).map((o, i) => (
          <option key={i} value={o.value}>{o.label || o.value}</option>
        ))}
      </select>
    );
  }
  if (type === 'object') {
    const text = typeof output.defaultValue === 'string'
      ? output.defaultValue
      : output.defaultValue != null ? JSON.stringify(output.defaultValue) : '';
    return (
      <textarea
        rows={2}
        value={text}
        placeholder='{ "key": "value" }'
        onChange={(e) => {
          const raw = e.target.value;
          if (raw === '') { onChange(undefined); return; }
          try { onChange(JSON.parse(raw)); } catch { onChange(raw); }
        }}
      />
    );
  }
  return (
    <input
      type="text"
      value={typeof output.defaultValue === 'string' ? output.defaultValue : ''}
      onChange={(e) => onChange(e.target.value || undefined)}
    />
  );
}

/**
 * Editor for a human-task node's `outputs` — the form fields a person fills in to complete the task.
 * The minimal case (name / type / required) stays inline; label, description, widget, select options
 * and default value live behind a per-output "Advanced" toggle (progressive disclosure) so simple
 * outputs stay uncluttered.
 */
function HumanTaskOutputsEditor({ outputs, onChange }: {
  outputs: HumanTaskOutput[];
  onChange: (outputs: HumanTaskOutput[]) => void;
}) {
  const [expanded, setExpanded] = useState<Record<number, boolean>>({});

  const update = (i: number, patch: Partial<HumanTaskOutput>) =>
    onChange(outputs.map((o, j) => (j === i ? { ...o, ...patch } : o)));

  return (
    <div className="properties-panel__inputs-list">
      {outputs.map((output, i) => {
        const type = output.type ?? 'string';
        const isOpen = !!expanded[i];
        return (
          <div key={i} className="properties-panel__input-item">
            <div className="properties-panel__input-row">
              <input
                type="text"
                value={output.name}
                placeholder="Name"
                onChange={(e) => update(i, { name: e.target.value })}
              />
              <select
                value={type}
                onChange={(e) => {
                  const newType = e.target.value as HumanTaskOutput['type'];
                  const patch: Partial<HumanTaskOutput> = { type: newType };
                  if (newType !== 'string') {
                    // widget/options only apply to string outputs; clear stale values
                    patch.widget = undefined;
                    patch.options = undefined;
                  }
                  update(i, patch);
                }}
              >
                <option value="string">string</option>
                <option value="number">number</option>
                <option value="boolean">boolean</option>
                <option value="object">object</option>
              </select>
              <button
                className="properties-panel__match-remove"
                title="Remove output"
                onClick={() => onChange(outputs.filter((_, j) => j !== i))}
              >
                &times;
              </button>
            </div>
            <label className="properties-panel__input-required">
              <input
                type="checkbox"
                checked={!!output.required}
                onChange={(e) => update(i, { required: e.target.checked })}
              />
              Required
            </label>
            <button
              type="button"
              className="properties-panel__output-advanced-toggle"
              onClick={() => setExpanded((prev) => ({ ...prev, [i]: !prev[i] }))}
            >
              {isOpen ? '▾' : '▸'} Advanced
            </button>
            {isOpen && (
              <div className="properties-panel__output-advanced">
                <div className="properties-panel__output-field">
                  <label>Label</label>
                  <input
                    type="text"
                    value={output.label ?? ''}
                    placeholder={output.name || 'Field label'}
                    onChange={(e) => update(i, { label: e.target.value || undefined })}
                  />
                </div>
                <div className="properties-panel__output-field">
                  <label>Description</label>
                  <textarea
                    rows={2}
                    value={output.description ?? ''}
                    placeholder="Help text shown under the field"
                    onChange={(e) => update(i, { description: e.target.value || undefined })}
                  />
                </div>
                {type === 'string' && (
                  <div className="properties-panel__output-field">
                    <label>Widget</label>
                    <select
                      value={output.widget ?? 'text'}
                      onChange={(e) => update(i, { widget: e.target.value as OutputWidget })}
                    >
                      {OUTPUT_WIDGETS.map((w) => <option key={w} value={w}>{w}</option>)}
                    </select>
                  </div>
                )}
                {type === 'string' && output.widget === 'select' && (
                  <OptionsEditor
                    options={output.options ?? []}
                    onChange={(options) => update(i, { options })}
                  />
                )}
                <div className="properties-panel__output-field">
                  <label>Default value</label>
                  <DefaultValueEditor
                    output={output}
                    onChange={(defaultValue) => update(i, { defaultValue })}
                  />
                </div>
              </div>
            )}
          </div>
        );
      })}
      <button
        className="properties-panel__match-add"
        onClick={() => onChange([...outputs, { name: '', type: 'string', required: true }])}
      >
        + Add output
      </button>
    </div>
  );
}

/**
 * Editor for a map-based input list (a `Record<string, string>` of key → value/EL-expression). The
 * list is edited internally as an ordered array of `{ key, value }` pairs — identified by position,
 * not by key — so that empty-key and duplicate-key entries can coexist without the silent data loss
 * a plain map suffers (an empty "+ Add input" overwriting the previous one, or a rename colliding
 * with an existing key). The map is reconstructed (last-wins) only when persisting via `onChange`,
 * and collisions are surfaced inline so the user can resolve them.
 */
function MapInputsEditor({ map, onChange, nodeId, keyPlaceholder, valuePlaceholder }: {
  map: Record<string, string> | undefined;
  onChange: (map: Record<string, string>) => void;
  nodeId: string;
  keyPlaceholder: string;
  valuePlaceholder: string;
}) {
  const [pairs, setPairs] = useState<KeyValuePair[]>(() => mapToPairs(map));
  const [sync, setSync] = useState<{ nodeId: string; map: Record<string, string> | undefined }>({ nodeId, map });
  // The exact map object this editor last emitted. The parent stores it verbatim
  // (see WorkflowEditor.onNodeDataChange), so it comes back by reference — letting
  // us tell our own echoed output apart from a genuine external change.
  const [lastEmitted, setLastEmitted] = useState<Record<string, string> | undefined>(undefined);

  // Adjusting state during render (rather than in an effect) is React's recommended pattern for
  // resetting state on prop change and avoids a cascading re-render.
  if (sync.nodeId !== nodeId) {
    // Node switch: always re-initialize from the new node's map. The previous node's in-progress
    // pairs must never carry over, even when both nodes happen to serialize to an equal map.
    setSync({ nodeId, map });
    setPairs(mapToPairs(map));
  } else if (sync.map !== map && map !== lastEmitted) {
    // Same node, and the incoming map reference changed to one we did not emit — a genuine external
    // change (undo/redo, source-view edit). Adopt it. Our own serialized output echoed back by the
    // parent (map === lastEmitted) is skipped entirely, so it neither resets in-progress
    // duplicate/empty rows nor schedules an extra render just to re-sync a reference we already know.
    setSync({ nodeId, map });
    setPairs(mapToPairs(map));
  }

  const dupes = duplicateKeys(pairs);

  const commit = (next: KeyValuePair[]) => {
    const nextMap = pairsToMap(next);
    setLastEmitted(nextMap);
    setPairs(next);
    onChange(nextMap);
  };

  return (
    <div className="properties-panel__inputs-list">
      {pairs.map((pair, i) => {
        const isDuplicate = dupes.has(pair.key);
        const isEmpty = pair.key === '';
        return (
          <div key={pair.id} className="properties-panel__input-item">
            <div className="properties-panel__input-row">
              <input
                type="text"
                className={isDuplicate ? 'properties-panel__input-invalid' : undefined}
                value={pair.key}
                placeholder={keyPlaceholder}
                onChange={(e) => commit(pairs.map((p, j) => (j === i ? { ...p, key: e.target.value } : p)))}
              />
              <button
                className="properties-panel__match-remove"
                title="Remove input"
                onClick={() => commit(pairs.filter((_, j) => j !== i))}
              >
                &times;
              </button>
            </div>
            <input
              type="text"
              value={pair.value}
              placeholder={valuePlaceholder}
              onChange={(e) => commit(pairs.map((p, j) => (j === i ? { ...p, value: e.target.value } : p)))}
            />
            {isDuplicate && (
              <div className="properties-panel__input-warning">
                Duplicate key "{pair.key}" — only the last entry will be saved.
              </div>
            )}
            {isEmpty && (
              <div className="properties-panel__input-warning">
                Key is empty — enter a name so this entry is saved.
              </div>
            )}
          </div>
        );
      })}
      <button
        className="properties-panel__match-add"
        onClick={() => commit([...pairs, { id: nextPairId(), key: '', value: '' }])}
      >
        + Add input
      </button>
    </div>
  );
}

export function PropertiesPanel({ selectedNode, selectedEdge, nodeProblems = [], onNodeChange, onNodeIdChange, onEdgeChange, spi, sampleContext, width, onResizeStart }: PropertiesPanelProps) {
  const { actionTypes, loading: actionTypesLoading } = useActionTypes(spi);

  // Wrap every panel state in a common shell that carries the (optionally
  // drag-resized) width and the resize handle, so the panel behaves the same
  // whether a node, an edge, or nothing is selected.
  const wrap = (children: React.ReactNode) => (
    <div className="properties-panel" style={width != null ? { width } : undefined}>
      {onResizeStart && (
        <div className="properties-panel__resize-handle" onMouseDown={onResizeStart} />
      )}
      {children}
    </div>
  );

  if (!selectedNode && !selectedEdge) {
    return wrap(
      <div className="properties-panel__empty">
        Select a node or edge to view its properties
      </div>,
    );
  }

  if (selectedNode) {
    return wrap(
      <>
        <div className="properties-panel__header">
          {selectedNode.data.nodeType} Node
        </div>
        <NodeProblems problems={nodeProblems} />
        <div className="properties-panel__field">
          <label>Node ID</label>
          <input
            type="text"
            value={selectedNode.id}
            onChange={(e) => onNodeIdChange(selectedNode.id, e.target.value)}
          />
        </div>
        <div className="properties-panel__field">
          <label>Name</label>
          <input
            type="text"
            value={selectedNode.data.name}
            onChange={(e) => onNodeChange(selectedNode.id, { name: e.target.value })}
          />
        </div>
        {selectedNode.data.nodeType === 'start' && (
          <div className="properties-panel__field">
            <label>Inputs</label>
            <div className="properties-panel__inputs-list">
              {((selectedNode.data.config.inputs as { name: string; type: string; required: boolean }[]) || []).map((input, i) => (
                <div key={i} className="properties-panel__input-item">
                  <div className="properties-panel__input-row">
                    <input
                      type="text"
                      value={input.name}
                      placeholder="Name"
                      onChange={(e) => {
                        const inputs = [...((selectedNode.data.config.inputs as any[]) || [])];
                        inputs[i] = { ...inputs[i], name: e.target.value };
                        onNodeChange(selectedNode.id, {
                          config: { ...selectedNode.data.config, inputs },
                        });
                      }}
                    />
                    <select
                      value={input.type}
                      onChange={(e) => {
                        const inputs = [...((selectedNode.data.config.inputs as any[]) || [])];
                        inputs[i] = { ...inputs[i], type: e.target.value };
                        onNodeChange(selectedNode.id, {
                          config: { ...selectedNode.data.config, inputs },
                        });
                      }}
                    >
                      <option value="string">string</option>
                      <option value="number">number</option>
                      <option value="boolean">boolean</option>
                      <option value="object">object</option>
                    </select>
                    <button
                      className="properties-panel__match-remove"
                      title="Remove input"
                      onClick={() => {
                        const inputs = ((selectedNode.data.config.inputs as any[]) || []).filter((_, j) => j !== i);
                        onNodeChange(selectedNode.id, {
                          config: { ...selectedNode.data.config, inputs },
                        });
                      }}
                    >
                      &times;
                    </button>
                  </div>
                  <label className="properties-panel__input-required">
                    <input
                      type="checkbox"
                      checked={input.required}
                      onChange={(e) => {
                        const inputs = [...((selectedNode.data.config.inputs as any[]) || [])];
                        inputs[i] = { ...inputs[i], required: e.target.checked };
                        onNodeChange(selectedNode.id, {
                          config: { ...selectedNode.data.config, inputs },
                        });
                      }}
                    />
                    Required
                  </label>
                </div>
              ))}
              <button
                className="properties-panel__match-add"
                onClick={() => {
                  const inputs = [...((selectedNode.data.config.inputs as any[]) || []), { name: '', type: 'string', required: true }];
                  onNodeChange(selectedNode.id, {
                    config: { ...selectedNode.data.config, inputs },
                  });
                }}
              >
                + Add input
              </button>
            </div>
          </div>
        )}
        {selectedNode.data.nodeType === 'human-task' && (
          <>
            <div className="properties-panel__field">
              <label>Description</label>
              <textarea
                rows={3}
                value={(selectedNode.data.config.description as string) || ''}
                placeholder="Instructions for the person completing this task"
                onChange={(e) => onNodeChange(selectedNode.id, {
                  config: { ...selectedNode.data.config, description: e.target.value },
                })}
              />
            </div>
            <div className="properties-panel__field">
              <label>Inputs (values to display)</label>
              <MapInputsEditor
                map={selectedNode.data.config.inputs as Record<string, string> | undefined}
                nodeId={selectedNode.id}
                keyPlaceholder="Label"
                valuePlaceholder="e.g. context.creditScore"
                onChange={(inputs) => onNodeChange(selectedNode.id, {
                  config: { ...selectedNode.data.config, inputs },
                })}
              />
            </div>
            <div className="properties-panel__field">
              <label>Outputs (form fields for completion)</label>
              <HumanTaskOutputsEditor
                outputs={(selectedNode.data.config.outputs as HumanTaskOutput[]) || []}
                onChange={(outputs) => onNodeChange(selectedNode.id, {
                  config: { ...selectedNode.data.config, outputs },
                })}
              />
            </div>
          </>
        )}
        {selectedNode.data.nodeType === 'wait' && (
          <div className="properties-panel__field">
            <label>Duration (ISO 8601)</label>
            <input
              type="text"
              value={(selectedNode.data.config.duration as string) || ''}
              placeholder="e.g. PT30M, PT2H, P1D"
              onChange={(e) => onNodeChange(selectedNode.id, {
                config: { ...selectedNode.data.config, duration: e.target.value },
              })}
            />
          </div>
        )}
        {selectedNode.data.nodeType === 'action' && (
          <ActionNodeFields
            node={selectedNode}
            onNodeChange={onNodeChange}
            actionTypes={actionTypes}
            actionTypesLoading={actionTypesLoading}
          />
        )}
        {selectedNode.data.nodeType === 'receive-event' && (
          <>
            <div className="properties-panel__field">
              <label>Event Type</label>
              <input
                type="text"
                value={(selectedNode.data.config.eventType as string) || ''}
                onChange={(e) => onNodeChange(selectedNode.id, {
                  config: { ...selectedNode.data.config, eventType: e.target.value },
                })}
              />
            </div>
            <div className="properties-panel__field">
              <label>Match Expressions (EL)</label>
              <div className="properties-panel__match-list">
                {((selectedNode.data.config.match as string[]) || []).map((expr, i) => (
                  <div key={i} className="properties-panel__match-item">
                    <input
                      type="text"
                      value={expr}
                      placeholder="e.g. event.repo == context.repo"
                      onChange={(e) => {
                        const match = [...((selectedNode.data.config.match as string[]) || [])];
                        match[i] = e.target.value;
                        onNodeChange(selectedNode.id, {
                          config: { ...selectedNode.data.config, match },
                        });
                      }}
                    />
                    <button
                      className="properties-panel__match-remove"
                      title="Remove expression"
                      onClick={() => {
                        const match = ((selectedNode.data.config.match as string[]) || []).filter((_, j) => j !== i);
                        onNodeChange(selectedNode.id, {
                          config: { ...selectedNode.data.config, match },
                        });
                      }}
                    >
                      &times;
                    </button>
                  </div>
                ))}
                <button
                  className="properties-panel__match-add"
                  onClick={() => {
                    const match = [...((selectedNode.data.config.match as string[]) || []), ''];
                    onNodeChange(selectedNode.id, {
                      config: { ...selectedNode.data.config, match },
                    });
                  }}
                >
                  + Add expression
                </button>
              </div>
            </div>
          </>
        )}
      </>,
    );
  }

  if (selectedEdge) {
    return wrap(
      <>
        <div className="properties-panel__header">Edge</div>
        <div className="properties-panel__field">
          <label>Label</label>
          <input
            type="text"
            value={(selectedEdge.data?.label as string) || ''}
            onChange={(e) => onEdgeChange(selectedEdge.id, { label: e.target.value })}
          />
        </div>
        <div className="properties-panel__field">
          <label>Condition (EL expression)</label>
          <textarea
            rows={3}
            value={(selectedEdge.data?.condition as string) || ''}
            onChange={(e) => onEdgeChange(selectedEdge.id, { condition: e.target.value })}
          />
          <ConditionTester
            condition={(selectedEdge.data?.condition as string) || ''}
            sampleContext={sampleContext}
          />
        </div>
        <div className="properties-panel__field">
          <label>Priority</label>
          <input
            type="number"
            value={(selectedEdge.data?.priority as number) ?? 0}
            onChange={(e) => onEdgeChange(selectedEdge.id, { priority: parseInt(e.target.value) || 0 })}
          />
        </div>
        <div className="properties-panel__field">
          <label>
            <input
              type="checkbox"
              checked={(selectedEdge.data?.isDefault as boolean) || false}
              onChange={(e) => onEdgeChange(selectedEdge.id, { isDefault: e.target.checked })}
            />
            Default edge (fallback when no conditions match)
          </label>
        </div>
        <div className="properties-panel__field">
          <label>Edge ID</label>
          <input type="text" value={selectedEdge.id} disabled />
        </div>
      </>,
    );
  }

  return null;
}

/**
 * An inline affordance for spot-checking a single edge condition against a pasted/sample context,
 * using the same {@code evaluateCondition} the simulator (and the Java engine) uses. Shows the
 * evaluated boolean or a clear evaluation error, without needing a full simulation run.
 */
function ConditionTester({ condition, sampleContext }: {
  condition: string;
  sampleContext?: Record<string, unknown>;
}) {
  const [open, setOpen] = useState(false);
  const [contextText, setContextText] = useState(() => JSON.stringify(sampleContext ?? {}, null, 2));
  const [result, setResult] = useState<{ value: boolean } | { error: string } | null>(null);

  const evaluate = () => {
    let context: unknown;
    try {
      context = contextText.trim() === '' ? {} : JSON.parse(contextText);
    } catch (e) {
      setResult({ error: `Invalid JSON: ${(e as Error).message}` });
      return;
    }
    if (context === null || typeof context !== 'object' || Array.isArray(context)) {
      setResult({ error: 'Context must be a JSON object' });
      return;
    }
    try {
      const value = evaluateCondition(condition, { context: context as Record<string, unknown> });
      setResult({ value });
    } catch (e) {
      const message = e instanceof ElEvaluationError ? e.message : (e as Error).message;
      setResult({ error: message });
    }
  };

  if (!open) {
    return (
      <button className="properties-panel__test-toggle" onClick={() => setOpen(true)}>
        Test condition
      </button>
    );
  }

  return (
    <div className="properties-panel__test">
      <JsonCodeEditor
        value={contextText}
        onChange={setContextText}
        minRows={4}
        ariaLabel="Sample context (JSON)"
      />
      <div className="properties-panel__test-actions">
        <button onClick={evaluate}>Evaluate</button>
        <button onClick={() => { setOpen(false); setResult(null); }}>Close</button>
      </div>
      {result && 'value' in result && (
        <div className={`properties-panel__test-result is-${result.value}`}>
          Result: {String(result.value)}
        </div>
      )}
      {result && 'error' in result && (
        <div className="properties-panel__test-result is-error">{result.error}</div>
      )}
    </div>
  );
}

function ActionNodeFields({ node, onNodeChange, actionTypes, actionTypesLoading }: {
  node: Node<FlowNodeData>;
  onNodeChange: (id: string, data: Partial<FlowNodeData>) => void;
  actionTypes: ActionTypeDescriptor[];
  actionTypesLoading: boolean;
}) {
  const currentActionType = (node.data.config.actionType as string) || '';
  const descriptor = actionTypes.find(at => at.value === currentActionType);
  const hasSpi = actionTypes.length > 0 || actionTypesLoading;

  const onActionTypeSelected = (value: string) => {
    const selected = actionTypes.find(at => at.value === value);
    const inputs: Record<string, string> = {};
    if (selected?.inputs) {
      for (const field of selected.inputs) {
        inputs[field.name] = '';
      }
    }
    const outputs = selected?.outputs?.map(f => ({
      name: f.name,
      type: f.type,
      required: f.required ?? false,
    })) ?? [];

    onNodeChange(node.id, {
      config: {
        ...node.data.config,
        actionType: value,
        inputs,
        outputs,
      },
    });
  };

  return (
    <>
      <div className="properties-panel__field">
        <label>Action Type</label>
        {hasSpi ? (
          <ActionTypeSelect
            value={currentActionType}
            actionTypes={actionTypes}
            loading={actionTypesLoading}
            onSelect={(value) => {
              const match = actionTypes.find(at => at.value === value);
              if (match) {
                onActionTypeSelected(value);
              } else {
                onNodeChange(node.id, {
                  config: { ...node.data.config, actionType: value },
                });
              }
            }}
            onClear={() => onActionTypeSelected('')}
          />
        ) : (
          <input
            type="text"
            value={currentActionType}
            onChange={(e) => onNodeChange(node.id, {
              config: { ...node.data.config, actionType: e.target.value },
            })}
          />
        )}
        {descriptor?.description && (
          <div className="properties-panel__field-hint">{descriptor.description}</div>
        )}
      </div>

      {hasSpi && descriptor ? (
        <>
          {descriptor.inputs && descriptor.inputs.length > 0 && (
            <div className="properties-panel__field">
              <label>Inputs</label>
              <div className="properties-panel__inputs-list">
                {descriptor.inputs.map((field) => {
                  const inputs = (node.data.config.inputs as Record<string, string>) || {};
                  return (
                    <div key={field.name} className="properties-panel__input-item">
                      <div className="properties-panel__spi-field-header">
                        <span className="properties-panel__spi-field-name">
                          {field.name}
                          {field.required && <span className="properties-panel__spi-required">*</span>}
                        </span>
                        <span className="properties-panel__spi-field-type">{field.type}</span>
                      </div>
                      {field.description && (
                        <div className="properties-panel__field-hint">{field.description}</div>
                      )}
                      <input
                        type="text"
                        value={inputs[field.name] ?? ''}
                        placeholder={`e.g. context.${field.name}`}
                        onChange={(e) => {
                          const updated = { ...inputs, [field.name]: e.target.value };
                          onNodeChange(node.id, {
                            config: { ...node.data.config, inputs: updated },
                          });
                        }}
                      />
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          {descriptor.outputs && descriptor.outputs.length > 0 && (
            <div className="properties-panel__field">
              <label>Outputs</label>
              <div className="properties-panel__inputs-list">
                {descriptor.outputs.map((field) => (
                  <div key={field.name} className="properties-panel__input-item">
                    <div className="properties-panel__spi-field-header">
                      <span className="properties-panel__spi-field-name">{field.name}</span>
                      <span className="properties-panel__spi-field-type">
                        {field.type}{field.required ? '' : '?'}
                      </span>
                    </div>
                    {field.description && (
                      <div className="properties-panel__field-hint">{field.description}</div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      ) : (
        <>
          <div className="properties-panel__field">
            <label>Inputs (values to pass to executor)</label>
            <MapInputsEditor
              map={node.data.config.inputs as Record<string, string> | undefined}
              nodeId={node.id}
              keyPlaceholder="Label"
              valuePlaceholder="e.g. context.loanAmount"
              onChange={(inputs) => onNodeChange(node.id, {
                config: { ...node.data.config, inputs },
              })}
            />
          </div>
          <div className="properties-panel__field">
            <label>Outputs (expected results)</label>
            <div className="properties-panel__inputs-list">
              {((node.data.config.outputs as { name: string; type: string; required: boolean }[]) || []).map((output, i) => (
                <div key={i} className="properties-panel__input-item">
                  <div className="properties-panel__input-row">
                    <input
                      type="text"
                      value={output.name}
                      placeholder="Name"
                      onChange={(e) => {
                        const outputs = [...((node.data.config.outputs as any[]) || [])];
                        outputs[i] = { ...outputs[i], name: e.target.value };
                        onNodeChange(node.id, {
                          config: { ...node.data.config, outputs },
                        });
                      }}
                    />
                    <select
                      value={output.type}
                      onChange={(e) => {
                        const outputs = [...((node.data.config.outputs as any[]) || [])];
                        outputs[i] = { ...outputs[i], type: e.target.value };
                        onNodeChange(node.id, {
                          config: { ...node.data.config, outputs },
                        });
                      }}
                    >
                      <option value="string">string</option>
                      <option value="number">number</option>
                      <option value="boolean">boolean</option>
                      <option value="object">object</option>
                    </select>
                    <button
                      className="properties-panel__match-remove"
                      title="Remove output"
                      onClick={() => {
                        const outputs = ((node.data.config.outputs as any[]) || []).filter((_, j) => j !== i);
                        onNodeChange(node.id, {
                          config: { ...node.data.config, outputs },
                        });
                      }}
                    >
                      &times;
                    </button>
                  </div>
                  <label className="properties-panel__input-required">
                    <input
                      type="checkbox"
                      checked={output.required}
                      onChange={(e) => {
                        const outputs = [...((node.data.config.outputs as any[]) || [])];
                        outputs[i] = { ...outputs[i], required: e.target.checked };
                        onNodeChange(node.id, {
                          config: { ...node.data.config, outputs },
                        });
                      }}
                    />
                    Required
                  </label>
                </div>
              ))}
              <button
                className="properties-panel__match-add"
                onClick={() => {
                  const outputs = [...((node.data.config.outputs as any[]) || []), { name: '', type: 'string', required: true }];
                  onNodeChange(node.id, {
                    config: { ...node.data.config, outputs },
                  });
                }}
              >
                + Add output
              </button>
            </div>
          </div>
        </>
      )}
    </>
  );
}

function ActionTypeSelect({ value, actionTypes, loading, onSelect, onClear }: {
  value: string;
  actionTypes: ActionTypeDescriptor[];
  loading: boolean;
  onSelect: (value: string) => void;
  onClear: () => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [filterText, setFilterText] = useState('');
  const textInputRef = useRef<HTMLInputElement>(null);

  const displayValue = useMemo(() => {
    const match = actionTypes.find(at => at.value === value);
    return match ? match.label : value;
  }, [value, actionTypes]);

  const inputValue = isOpen ? filterText : displayValue;

  const filteredOptions = useMemo(() => {
    if (!filterText) return actionTypes;
    const lower = filterText.toLowerCase();
    return actionTypes.filter(at =>
      at.label.toLowerCase().includes(lower) || at.value.toLowerCase().includes(lower),
    );
  }, [filterText, actionTypes]);

  const isCustom = isOpen && filterText && !actionTypes.some(at =>
    at.value === filterText || at.label.toLowerCase() === filterText.toLowerCase(),
  );

  const onInputChange = (_event: React.FormEvent<HTMLInputElement>, val: string) => {
    setFilterText(val);
    if (!isOpen) setIsOpen(true);
  };

  const onOptionSelect = (_event: React.MouseEvent | undefined, val: string | number | undefined) => {
    const selected = String(val);
    if (selected.startsWith('__create__:')) {
      const custom = selected.slice('__create__:'.length);
      onSelect(custom);
    } else {
      onSelect(selected);
    }
    setFilterText('');
    setIsOpen(false);
    textInputRef.current?.focus();
  };

  const handleClear = () => {
    setFilterText('');
    onClear();
    textInputRef.current?.focus();
  };

  const handleOpenChange = (open: boolean) => {
    setIsOpen(open);
    if (open) {
      setFilterText('');
    }
  };

  const toggle = (toggleRef: React.Ref<MenuToggleElement>) => (
    <MenuToggle
      ref={toggleRef}
      variant="typeahead"
      onClick={() => { handleOpenChange(!isOpen); textInputRef.current?.focus(); }}
      isExpanded={isOpen}
      isDisabled={loading}
      isFullWidth
    >
      <TextInputGroup isPlain>
        <TextInputGroupMain
          value={inputValue}
          onClick={() => { if (!isOpen) setIsOpen(true); }}
          onChange={onInputChange}
          innerRef={textInputRef}
          placeholder={loading ? 'Loading...' : 'Select or type an action type'}
          autoComplete="off"
        />
        {(value || inputValue) && (
          <TextInputGroupUtilities>
            <Button variant="plain" onClick={handleClear} aria-label="Clear action type">
              <TimesIcon />
            </Button>
          </TextInputGroupUtilities>
        )}
      </TextInputGroup>
    </MenuToggle>
  );

  return (
    <Select
      isOpen={isOpen}
      selected={value}
      onSelect={onOptionSelect}
      onOpenChange={handleOpenChange}
      toggle={toggle}
      shouldFocusFirstItemOnOpen={false}
    >
      <SelectList>
        {filteredOptions.map(at => (
          <SelectOption key={at.value} value={at.value} description={at.description}>
            {at.label}
          </SelectOption>
        ))}
        {isCustom && (
          <SelectOption value={`__create__:${inputValue}`}>
            {`Use custom type "${inputValue}"`}
          </SelectOption>
        )}
        {filteredOptions.length === 0 && !isCustom && (
          <SelectOption isDisabled>No results found</SelectOption>
        )}
      </SelectList>
    </Select>
  );
}

type MenuToggleElement = HTMLButtonElement;
