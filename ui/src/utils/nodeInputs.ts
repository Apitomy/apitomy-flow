import type { HistoryEntry } from '../types/instance.ts';
import type { WorkflowNode } from '../types/workflow.ts';

/** A single row in the viewer's per-visit "Inputs" section. */
export interface InputRow {
  /** The input name. */
  name: string;
  /** The declared type label (start nodes only), e.g. `string` or `number?` for an optional input. */
  typeLabel?: string;
  /** Whether a value was recorded for this input on the visit. */
  hasValue: boolean;
  /** The recorded value, when {@link hasValue} is true. */
  value?: unknown;
}

/**
 * Builds the rows for a node visit's "Inputs" section. Start nodes list every declared workflow input
 * (with its type), paired with the value recorded on the visit when there is one. Other nodes list the
 * input values recorded on the visit's history entry.
 *
 * @param node the node being shown
 * @param history the selected visit, or `null` when the node was not visited
 * @return the rows to render, empty when there is nothing to show
 */
export function nodeInputRows(node: WorkflowNode, history: HistoryEntry | null): InputRow[] {
  const recorded = history?.input ?? {};
  const has = (name: string) => Object.prototype.hasOwnProperty.call(recorded, name);
  if (node.type === 'start') {
    const declared = Array.isArray(node.config.inputs) ? node.config.inputs : [];
    return declared.map(input => ({
      name: input.name,
      typeLabel: `${input.type}${input.required ? '' : '?'}`,
      hasValue: has(input.name),
      ...(has(input.name) ? { value: recorded[input.name] } : {}),
    }));
  }
  return Object.entries(recorded).map(([name, value]) => ({ name, hasValue: true, value }));
}
