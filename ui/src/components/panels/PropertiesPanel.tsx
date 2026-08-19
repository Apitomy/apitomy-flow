import { useState, useEffect } from 'react';
import { type Node, type Edge } from '@xyflow/react';
import { type FlowNodeData } from '../../utils/conversion.ts';
import { type EditorSpi } from '../../types/spi.ts';
import { type ActionTypeDescriptor } from '../../types/spi.ts';
import './PropertiesPanel.css';

interface PropertiesPanelProps {
  selectedNode?: Node<FlowNodeData>;
  selectedEdge?: Edge;
  onNodeChange: (id: string, data: Partial<FlowNodeData>) => void;
  onEdgeChange: (id: string, data: Record<string, any>) => void;
  spi?: EditorSpi;
}

function useActionTypes(spi?: EditorSpi): { actionTypes: ActionTypeDescriptor[]; loading: boolean } {
  const [resolved, setResolved] = useState<ActionTypeDescriptor[] | null>(null);
  const [loading, setLoading] = useState(false);
  const provider = spi?.actionTypes;

  useEffect(() => {
    if (!provider) {
      setResolved(null);
      return;
    }
    if (Array.isArray(provider)) {
      setResolved(provider);
      return;
    }
    let cancelled = false;
    setLoading(true);
    provider().then(
      (result) => { if (!cancelled) { setResolved(result); setLoading(false); } },
      () => { if (!cancelled) { setResolved([]); setLoading(false); } },
    );
    return () => { cancelled = true; };
  }, [provider]);

  return { actionTypes: resolved ?? [], loading };
}

export function PropertiesPanel({ selectedNode, selectedEdge, onNodeChange, onEdgeChange, spi }: PropertiesPanelProps) {
  const { actionTypes, loading: actionTypesLoading } = useActionTypes(spi);

  if (!selectedNode && !selectedEdge) {
    return (
      <div className="properties-panel">
        <div className="properties-panel__empty">
          Select a node or edge to view its properties
        </div>
      </div>
    );
  }

  if (selectedNode) {
    return (
      <div className="properties-panel">
        <div className="properties-panel__header">
          {selectedNode.data.nodeType} Node
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
              <div className="properties-panel__inputs-list">
                {Object.entries((selectedNode.data.config.inputs as Record<string, string>) || {}).map(([name, expr], i) => (
                  <div key={i} className="properties-panel__input-item">
                    <div className="properties-panel__input-row">
                      <input
                        type="text"
                        value={name}
                        placeholder="Label"
                        onChange={(e) => {
                          const entries = Object.entries((selectedNode.data.config.inputs as Record<string, string>) || {});
                          entries[i] = [e.target.value, entries[i][1]];
                          onNodeChange(selectedNode.id, {
                            config: { ...selectedNode.data.config, inputs: Object.fromEntries(entries) },
                          });
                        }}
                      />
                      <button
                        className="properties-panel__match-remove"
                        title="Remove input"
                        onClick={() => {
                          const entries = Object.entries((selectedNode.data.config.inputs as Record<string, string>) || {}).filter((_, j) => j !== i);
                          onNodeChange(selectedNode.id, {
                            config: { ...selectedNode.data.config, inputs: Object.fromEntries(entries) },
                          });
                        }}
                      >
                        &times;
                      </button>
                    </div>
                    <input
                      type="text"
                      value={expr}
                      placeholder="e.g. context.creditScore"
                      onChange={(e) => {
                        const entries = Object.entries((selectedNode.data.config.inputs as Record<string, string>) || {});
                        entries[i] = [entries[i][0], e.target.value];
                        onNodeChange(selectedNode.id, {
                          config: { ...selectedNode.data.config, inputs: Object.fromEntries(entries) },
                        });
                      }}
                    />
                  </div>
                ))}
                <button
                  className="properties-panel__match-add"
                  onClick={() => {
                    const inputs = { ...((selectedNode.data.config.inputs as Record<string, string>) || {}), '': '' };
                    onNodeChange(selectedNode.id, {
                      config: { ...selectedNode.data.config, inputs },
                    });
                  }}
                >
                  + Add input
                </button>
              </div>
            </div>
            <div className="properties-panel__field">
              <label>Outputs (form fields for completion)</label>
              <div className="properties-panel__inputs-list">
                {((selectedNode.data.config.outputs as { name: string; type: string; required: boolean }[]) || []).map((output, i) => (
                  <div key={i} className="properties-panel__input-item">
                    <div className="properties-panel__input-row">
                      <input
                        type="text"
                        value={output.name}
                        placeholder="Name"
                        onChange={(e) => {
                          const outputs = [...((selectedNode.data.config.outputs as any[]) || [])];
                          outputs[i] = { ...outputs[i], name: e.target.value };
                          onNodeChange(selectedNode.id, {
                            config: { ...selectedNode.data.config, outputs },
                          });
                        }}
                      />
                      <select
                        value={output.type}
                        onChange={(e) => {
                          const outputs = [...((selectedNode.data.config.outputs as any[]) || [])];
                          outputs[i] = { ...outputs[i], type: e.target.value };
                          onNodeChange(selectedNode.id, {
                            config: { ...selectedNode.data.config, outputs },
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
                          const outputs = ((selectedNode.data.config.outputs as any[]) || []).filter((_, j) => j !== i);
                          onNodeChange(selectedNode.id, {
                            config: { ...selectedNode.data.config, outputs },
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
                          const outputs = [...((selectedNode.data.config.outputs as any[]) || [])];
                          outputs[i] = { ...outputs[i], required: e.target.checked };
                          onNodeChange(selectedNode.id, {
                            config: { ...selectedNode.data.config, outputs },
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
                    const outputs = [...((selectedNode.data.config.outputs as any[]) || []), { name: '', type: 'string', required: true }];
                    onNodeChange(selectedNode.id, {
                      config: { ...selectedNode.data.config, outputs },
                    });
                  }}
                >
                  + Add output
                </button>
              </div>
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
        <div className="properties-panel__field">
          <label>Node ID</label>
          <input type="text" value={selectedNode.id} disabled />
        </div>
      </div>
    );
  }

  if (selectedEdge) {
    return (
      <div className="properties-panel">
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
      </div>
    );
  }

  return null;
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
          <select
            value={currentActionType}
            disabled={actionTypesLoading}
            onChange={(e) => onActionTypeSelected(e.target.value)}
          >
            <option value="">{actionTypesLoading ? 'Loading...' : '— Select action type —'}</option>
            {actionTypes.map(at => (
              <option key={at.value} value={at.value}>{at.label}</option>
            ))}
          </select>
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
            <div className="properties-panel__inputs-list">
              {Object.entries((node.data.config.inputs as Record<string, string>) || {}).map(([name, expr], i) => (
                <div key={i} className="properties-panel__input-item">
                  <div className="properties-panel__input-row">
                    <input
                      type="text"
                      value={name}
                      placeholder="Label"
                      onChange={(e) => {
                        const entries = Object.entries((node.data.config.inputs as Record<string, string>) || {});
                        entries[i] = [e.target.value, entries[i][1]];
                        onNodeChange(node.id, {
                          config: { ...node.data.config, inputs: Object.fromEntries(entries) },
                        });
                      }}
                    />
                    <button
                      className="properties-panel__match-remove"
                      title="Remove input"
                      onClick={() => {
                        const entries = Object.entries((node.data.config.inputs as Record<string, string>) || {}).filter((_, j) => j !== i);
                        onNodeChange(node.id, {
                          config: { ...node.data.config, inputs: Object.fromEntries(entries) },
                        });
                      }}
                    >
                      &times;
                    </button>
                  </div>
                  <input
                    type="text"
                    value={expr}
                    placeholder="e.g. context.loanAmount"
                    onChange={(e) => {
                      const entries = Object.entries((node.data.config.inputs as Record<string, string>) || {});
                      entries[i] = [entries[i][0], e.target.value];
                      onNodeChange(node.id, {
                        config: { ...node.data.config, inputs: Object.fromEntries(entries) },
                      });
                    }}
                  />
                </div>
              ))}
              <button
                className="properties-panel__match-add"
                onClick={() => {
                  const inputs = { ...((node.data.config.inputs as Record<string, string>) || {}), '': '' };
                  onNodeChange(node.id, {
                    config: { ...node.data.config, inputs },
                  });
                }}
              >
                + Add input
              </button>
            </div>
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
