import { type WorkflowNode } from '../types/workflow.ts';
import { inputValueText } from './mapInputs.ts';

/**
 * A single labeled value in a node's definition view, e.g. `orderId: string` for a start node
 * input, or `messageId: string` for an action node output.
 */
export interface DefinitionField {
  /** Field name, or a human-friendly label when the source data provides one. */
  label: string;
  /** Formatted value (e.g. a description, expression, or literal config value). */
  value?: string;
  /** Short type/requiredness badge shown next to the label (e.g. `string`, `boolean?`). */
  badge?: string;
}

/** A labeled group of {@link DefinitionField}s, e.g. "Inputs", "Outputs", or "Config". */
export interface DefinitionSection {
  label: string;
  fields: DefinitionField[];
}

/** The as-authored definition of a {@link WorkflowNode}, shaped for display in the Viewer's detail panel. */
export interface NodeDefinitionView {
  id: string;
  type: string;
  name: string;
  /** Free-text instructions (currently only populated for human-task nodes). */
  description?: string;
  sections: DefinitionSection[];
}

/** Fields consumed directly by the special-cased sections below, and therefore excluded from the generic Config fallback. */
const HANDLED_CONFIG_KEYS: Record<string, Set<string>> = {
  start: new Set(['inputs']),
  'human-task': new Set(['description', 'inputs', 'outputs']),
  action: new Set(['actionType', 'inputs', 'outputs']),
  'receive-event': new Set(['outputs']),
};

function formatConfigValue(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

/** Builds an "Inputs" section from expressions or JSON literals on action and human-task nodes. */
function mapInputsSection(config: Record<string, any>): DefinitionSection | null {
  const inputs = config.inputs;
  if (!inputs || typeof inputs !== 'object' || Array.isArray(inputs) || Object.keys(inputs).length === 0) return null;
  return {
    label: 'Inputs',
    fields: Object.entries(inputs as Record<string, unknown>).map(([key, value]) => ({
      label: key,
      value: inputValueText(value),
    })),
  };
}

function startInputsSection(config: Record<string, any>): DefinitionSection | null {
  const inputs = config.inputs;
  if (!Array.isArray(inputs) || inputs.length === 0) return null;
  return {
    label: 'Inputs',
    fields: inputs.map((input: { name: string; type: string; required: boolean; description?: string }) => ({
      label: input.name,
      badge: `${input.type}${input.required ? '' : '?'}`,
      value: input.description,
    })),
  };
}

function humanTaskOutputsSection(config: Record<string, any>): DefinitionSection | null {
  const outputs = config.outputs;
  if (!Array.isArray(outputs) || outputs.length === 0) return null;
  return {
    label: 'Outputs',
    fields: outputs.map((output: {
      name: string; type?: string; label?: string; description?: string; contextKey?: string;
    }) => ({
      label: output.label ?? output.name,
      badge: output.type ?? 'string',
      value: describeOutputValue(output.description, output.contextKey),
    })),
  };
}

/**
 * Combines an output's optional description with its optional `contextKey` override into a single
 * display value, e.g. `"Approve or reject — stored as context.managerApproved"`, or just
 * `"stored as context.managerApproved"` when there's no description. Returns `undefined` when
 * neither is present.
 */
function describeOutputValue(description: string | undefined, contextKey: string | undefined): string | undefined {
  const storedAs = contextKey ? `stored as context.${contextKey}` : undefined;
  if (description && storedAs) return `${description} — ${storedAs}`;
  return description ?? storedAs;
}

function actionSections(config: Record<string, any>): DefinitionSection[] {
  const sections: DefinitionSection[] = [];

  if (config.actionType !== undefined) {
    sections.push({
      label: 'Config',
      fields: [{ label: 'actionType', value: String(config.actionType) }],
    });
  }

  const inputs = mapInputsSection(config);
  if (inputs) sections.push(inputs);

  const outputs = config.outputs;
  if (Array.isArray(outputs) && outputs.length > 0) {
    sections.push({
      label: 'Outputs',
      fields: outputs.map((output: { name: string; type: string; required: boolean; contextKey?: string }) => ({
        label: output.name,
        badge: output.type,
        value: describeOutputValue(undefined, output.contextKey),
      })),
    });
  }

  return sections;
}

function receiveEventOutputsSection(config: Record<string, any>): DefinitionSection | null {
  const outputs = config.outputs;
  if (!Array.isArray(outputs) || outputs.length === 0) return null;
  const fields = outputs
    .filter((output): output is { contextKey?: string; expression?: string } =>
      typeof output === 'object' && output !== null)
    .map(output => ({
      label: output.contextKey ?? '(missing contextKey)',
      value: output.expression,
    }));
  if (fields.length === 0) return null;
  return {
    label: 'Output mappings',
    fields,
  };
}

function genericConfigSection(config: Record<string, any>, handledKeys: Set<string>): DefinitionSection | null {
  const entries = Object.entries(config).filter(([key]) => !handledKeys.has(key));
  if (entries.length === 0) return null;
  return {
    label: 'Config',
    fields: entries.map(([key, value]) => ({ label: key, value: formatConfigValue(value) })),
  };
}

/**
 * Derives the as-authored definition of a workflow node — its id/type/name plus type-specific
 * sections (e.g. inputs/outputs) — for display in the Viewer's "Definition" detail view.
 *
 * @param node the workflow node to describe
 * @return a display-ready definition view; sections that would be empty are omitted
 */
export function getNodeDefinition(node: WorkflowNode): NodeDefinitionView {
  const config = node.config ?? {};
  const handledKeys = HANDLED_CONFIG_KEYS[node.type] ?? new Set<string>();

  let sections: DefinitionSection[];
  let description: string | undefined;
  if (node.type === 'start') {
    sections = [startInputsSection(config)].filter((s): s is DefinitionSection => s !== null);
  } else if (node.type === 'human-task') {
    description = typeof config.description === 'string' && config.description ? config.description : undefined;
    sections = [mapInputsSection(config), humanTaskOutputsSection(config)]
      .filter((s): s is DefinitionSection => s !== null);
  } else if (node.type === 'action') {
    sections = actionSections(config);
  } else if (node.type === 'receive-event') {
    sections = [receiveEventOutputsSection(config)].filter((s): s is DefinitionSection => s !== null);
  } else {
    sections = [];
  }

  const generic = genericConfigSection(config, handledKeys);
  if (generic) sections = [...sections, generic];

  return { id: node.id, type: node.type, name: node.name, description, sections };
}
