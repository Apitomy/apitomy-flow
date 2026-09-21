import { useState, useEffect, useMemo } from 'react';
import { type Node, type Edge } from '@xyflow/react';
import { ActionTypeSelect } from './ActionTypeSelect.tsx';
import { type FlowNodeData } from '../../utils/conversion.ts';
import type { WorkflowInput, ReceiveEventConfig } from '../../types/workflow.ts';
import { type EditorSpi } from '../../types/spi.ts';
import { type ActionTypeDescriptor } from '../../types/spi.ts';
import { type HumanTaskOutput, type OutputWidget, type ActionOutputConfig, type EventOutputMapping } from '../../types/workflow.ts';
import { type ValidationProblem } from '../../types/validation.ts';
import { inputValueText } from '../../utils/mapInputs.ts';
import { MapInputsEditor } from './MapInputsEditor.tsx';
import { DefaultValueEditor, OptionsEditor } from './HumanTaskOutputFields.tsx';
import { evaluateCondition, ElEvaluationError } from '../../simulation/elEvaluator.ts';
import { JsonCodeEditor } from '../common/JsonCodeEditor.tsx';
import './PropertiesPanel.css';

interface PropertiesPanelProps {
  /** Stable logical node identity plus explicit history/import/selection reset token. */
  draftIdentity?: string;
  selectedNode?: Node<FlowNodeData>;
  selectedEdge?: Edge;
  nodeProblems?: ValidationProblem[];
  onNodeChange: (id: string, data: Partial<FlowNodeData>) => void;
  onNodeIdChange: (oldId: string, newId: string) => void;
  onEdgeChange: (id: string, data: Record<string, unknown>) => void;
  spi?: EditorSpi;
  /** A sample context used to seed the inline "Test condition" affordance. */
  sampleContext?: Record<string, unknown>;
  /** Current panel width in pixels. When omitted, the CSS default width is used. */
  width?: number;
  /** Starts a drag-resize when the user presses the panel's resize handle. */
  onResizeStart?: (e: React.MouseEvent) => void;
}

/**
 * Reads a node's `config.outputs` as a list of receive-event output mappings, defensively:
 * a missing/non-array `outputs` yields an empty list, and any non-object entry (e.g. `null`
 * from a malformed imported definition) is dropped rather than crashing the editor. Missing
 * `contextKey`/`expression` fields on an otherwise-valid entry default to `''` for editing.
 */
function getOutputMappings(config: ReceiveEventConfig): EventOutputMapping[] {
  const outputs = config.outputs;
  if (!Array.isArray(outputs)) return [];
  return outputs
    .filter(o => typeof o === 'object' && o !== null)
    .map(o => ({ ...o, contextKey: o.contextKey ?? '', expression: o.expression ?? '' }));
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
                <div className="properties-panel__output-field">
                  <label>Context key</label>
                  <input
                    type="text"
                    value={output.contextKey ?? ''}
                    placeholder={output.name || 'Defaults to name'}
                    onChange={(e) => update(i, { contextKey: e.target.value || undefined })}
                  />
                  <div className="properties-panel__field-hint">
                    Context key the answer is stored under. Override this to avoid collisions when
                    the same output name is used by more than one node.
                  </div>
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

/** Coordinates selected entity editing; child forms own their local presentation and draft state. */
export function PropertiesPanel({ selectedNode, selectedEdge, draftIdentity, nodeProblems = [], onNodeChange, onNodeIdChange, onEdgeChange, spi, sampleContext, width, onResizeStart }: PropertiesPanelProps) {
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
    // Capture narrowed configs for callbacks; narrowing mutable nested properties is not retained in closures.
    const startInputs = selectedNode.data.nodeType === 'start' ? selectedNode.data.config.inputs ?? [] : [];
    const eventConfig = selectedNode.data.nodeType === 'receive-event' ? selectedNode.data.config : {};
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
              {startInputs.map((input, i) => (
                <div key={i} className="properties-panel__input-item">
                  <div className="properties-panel__input-row">
                    <input
                      type="text"
                      value={input.name}
                      placeholder="Name"
                      onChange={(e) => {
                        const inputs = [...startInputs];
                        inputs[i] = { ...inputs[i], name: e.target.value };
                        onNodeChange(selectedNode.id, {
                          config: { ...selectedNode.data.config, inputs },
                        });
                      }}
                    />
                    <select
                      value={input.type ?? 'string'}
                      onChange={(e) => {
                        const inputs = [...startInputs];
                        inputs[i] = { ...inputs[i], type: e.target.value as WorkflowInput['type'] };
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
                        const inputs = startInputs.filter((_, j) => j !== i);
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
                      checked={input.required ?? false}
                      onChange={(e) => {
                        const inputs = [...startInputs];
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
                  const inputs: WorkflowInput[] = [...startInputs, { name: '', type: 'string', required: true }];
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
                map={selectedNode.data.config.inputs}
                draftIdentity={draftIdentity ?? selectedNode.id}
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
                outputs={selectedNode.data.config.outputs || []}
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
            draftIdentity={draftIdentity}
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
                {(eventConfig.match || []).map((expr, i) => (
                  <div key={i} className="properties-panel__match-item">
                    <input
                      type="text"
                      value={expr}
                      placeholder="e.g. event.repo == context.repo"
                      onChange={(e) => {
                        const match = [...(eventConfig.match || [])];
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
                        const match = (eventConfig.match || []).filter((_, j) => j !== i);
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
                    const match = [...(eventConfig.match || []), ''];
                    onNodeChange(selectedNode.id, {
                      config: { ...selectedNode.data.config, match },
                    });
                  }}
                >
                  + Add expression
                </button>
              </div>
            </div>
            <div className="properties-panel__field">
              <label>Output mappings</label>
              <div className="properties-panel__inputs-list">
                {getOutputMappings(eventConfig).map((mapping, i) => (
                  <div key={i} className="properties-panel__input-item">
                    <div className="properties-panel__input-row">
                      <input
                        type="text"
                        value={mapping.contextKey ?? ''}
                        placeholder="Context key"
                        onChange={(e) => {
                          const outputs = getOutputMappings(eventConfig);
                          outputs[i] = { ...outputs[i], contextKey: e.target.value };
                          onNodeChange(selectedNode.id, {
                            config: { ...selectedNode.data.config, outputs },
                          });
                        }}
                      />
                      <input
                        type="text"
                        value={mapping.expression ?? ''}
                        placeholder="e.g. event.payload.id"
                        onChange={(e) => {
                          const outputs = getOutputMappings(eventConfig);
                          outputs[i] = { ...outputs[i], expression: e.target.value };
                          onNodeChange(selectedNode.id, {
                            config: { ...selectedNode.data.config, outputs },
                          });
                        }}
                      />
                      <button
                        className="properties-panel__match-remove"
                        title="Remove output mapping"
                        onClick={() => {
                          const outputs = getOutputMappings(eventConfig).filter((_, j) => j !== i);
                          onNodeChange(selectedNode.id, {
                            config: { ...selectedNode.data.config, outputs },
                          });
                        }}
                      >
                        &times;
                      </button>
                    </div>
                  </div>
                ))}
                <button
                  className="properties-panel__match-add"
                  onClick={() => {
                    const outputs = [
                      ...getOutputMappings(eventConfig),
                      { contextKey: '', expression: '' },
                    ];
                    onNodeChange(selectedNode.id, {
                      config: { ...selectedNode.data.config, outputs },
                    });
                  }}
                >
                  + Add output mapping
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

function ActionNodeFields({ node, onNodeChange, actionTypes, actionTypesLoading, draftIdentity }: {
  draftIdentity?: string;
  node: Node<FlowNodeData>;
  onNodeChange: (id: string, data: Partial<FlowNodeData>) => void;
  actionTypes: ActionTypeDescriptor[];
  actionTypesLoading: boolean;
}) {
  if (node.data.nodeType !== 'action') return null;
  const config = node.data.config;
  const currentActionType = config.actionType || '';
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
                  const inputs = config.inputs || {};
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
                        value={inputValueText(inputs[field.name])}
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
                {descriptor.outputs.map((field) => {
                  const configOutputs = config.outputs || [];
                  const configOutput = configOutputs.find(o => o.name === field.name);
                  return (
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
                      <input
                        type="text"
                        value={configOutput?.contextKey ?? ''}
                        placeholder={`Context key (defaults to "${field.name}")`}
                        onChange={(e) => {
                          const contextKey = e.target.value || undefined;
                          const nextOutputs = configOutputs.some(o => o.name === field.name)
                            ? configOutputs.map(o => (o.name === field.name ? { ...o, contextKey } : o))
                            : [...configOutputs, {
                              name: field.name, type: field.type, required: field.required ?? false, contextKey,
                            }];
                          onNodeChange(node.id, {
                            config: { ...node.data.config, outputs: nextOutputs },
                          });
                        }}
                      />
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </>
      ) : (
        <>
          <div className="properties-panel__field">
            <label>Inputs (values to pass to executor)</label>
            <MapInputsEditor
              map={config.inputs}
              draftIdentity={draftIdentity ?? node.id}
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
              {(config.outputs || []).map((output, i) => (
                <div key={i} className="properties-panel__input-item">
                  <div className="properties-panel__input-row">
                    <input
                      type="text"
                      value={output.name}
                      placeholder="Name"
                      onChange={(e) => {
                        const outputs = [...(config.outputs || [])];
                        outputs[i] = { ...outputs[i], name: e.target.value };
                        onNodeChange(node.id, {
                          config: { ...node.data.config, outputs },
                        });
                      }}
                    />
                    <select
                      value={output.type ?? 'string'}
                      onChange={(e) => {
                        const outputs = [...(config.outputs || [])];
                        outputs[i] = { ...outputs[i], type: e.target.value as ActionOutputConfig['type'] };
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
                        const outputs = (config.outputs || []).filter((_, j) => j !== i);
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
                      checked={output.required ?? false}
                      onChange={(e) => {
                        const outputs = [...(config.outputs || [])];
                        outputs[i] = { ...outputs[i], required: e.target.checked };
                        onNodeChange(node.id, {
                          config: { ...node.data.config, outputs },
                        });
                      }}
                    />
                    Required
                  </label>
                  <div className="properties-panel__output-field">
                    <label>Context key</label>
                    <input
                      type="text"
                      value={output.contextKey ?? ''}
                      placeholder={output.name || 'Defaults to name'}
                      onChange={(e) => {
                        const outputs = [...(config.outputs || [])];
                        outputs[i] = { ...outputs[i], contextKey: e.target.value || undefined };
                        onNodeChange(node.id, {
                          config: { ...node.data.config, outputs },
                        });
                      }}
                    />
                  </div>
                </div>
              ))}
              <button
                className="properties-panel__match-add"
                onClick={() => {
                  const outputs: ActionOutputConfig[] = [...(config.outputs || []), { name: '', type: 'string', required: true }];
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
