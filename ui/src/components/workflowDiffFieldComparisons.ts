import { type NodeType } from '../types/workflow.ts';
import { type EdgeDiffRecord, type NodeDiffRecord } from '../diff/workflowDiffTypes.ts';

export interface FieldComparison {
  field: string;
  before: unknown;
  after: unknown;
}

const NODE_CONFIG_FIELDS: Record<NodeType, string[]> = {
  start: ['inputs'],
  end: ['outcome'],
  action: ['description', 'actionType', 'inputs', 'outputs'],
  'human-task': ['description', 'assignee', 'inputs', 'outputs'],
  'receive-event': ['eventType', 'description', 'inputs', 'outputs'],
  wait: ['duration'],
};

function areEqual(before: unknown, after: unknown): boolean {
  try {
    return JSON.stringify(before) === JSON.stringify(after);
  } catch {
    return Object.is(before, after);
  }
}

function changedConfigFields(record: NodeDiffRecord): FieldComparison[] {
  const baseConfig = record.baseNode?.config;
  const compareConfig = record.compareNode?.config;
  if (!baseConfig || !compareConfig || typeof baseConfig !== 'object' || typeof compareConfig !== 'object') {
    return [{ field: 'config', before: baseConfig, after: compareConfig }];
  }

  const nodeType = (record.compareNode?.type ?? record.baseNode?.type) as NodeType | undefined;
  const knownFields = nodeType ? NODE_CONFIG_FIELDS[nodeType] ?? [] : [];
  const allFields = [...new Set([...Object.keys(baseConfig), ...Object.keys(compareConfig)])].sort();
  const unknownFields = allFields.filter((field) => !knownFields.includes(field));
  const orderedFields = [...knownFields, ...unknownFields];

  const comparisons: FieldComparison[] = [];
  for (const field of orderedFields) {
    const before = (baseConfig as Record<string, unknown>)[field];
    const after = (compareConfig as Record<string, unknown>)[field];
    if (areEqual(before, after)) {
      continue;
    }
    comparisons.push({
      field: knownFields.includes(field) ? field : `config.${field}`,
      before,
      after,
    });
  }

  return comparisons.length > 0
    ? comparisons
    : [{ field: 'config', before: baseConfig, after: compareConfig }];
}

/**
 * Build node field comparisons for the detail panel, expanding config into
 * granular node-type-specific fields.
 */
export function nodeFieldComparisons(record: NodeDiffRecord): FieldComparison[] {
  const comparisons: FieldComparison[] = [];

  for (const field of record.changes) {
    if (field === 'config') {
      comparisons.push(...changedConfigFields(record));
      continue;
    }
    if (field === 'position') {
      comparisons.push({ field, before: record.baseNode?.position, after: record.compareNode?.position });
      continue;
    }
    if (field === 'name') {
      comparisons.push({ field, before: record.baseNode?.name, after: record.compareNode?.name });
      continue;
    }
    if (field === 'type') {
      comparisons.push({ field, before: record.baseNode?.type, after: record.compareNode?.type });
      continue;
    }
  }

  return comparisons;
}

/**
 * Build edge field comparisons for the detail panel.
 */
export function edgeFieldComparisons(record: EdgeDiffRecord): FieldComparison[] {
  return record.changes.map((field) => ({
    field,
    before: field === 'source'
      ? record.baseEdge?.source
      : field === 'target'
        ? record.baseEdge?.target
        : field === 'condition'
          ? record.baseEdge?.condition
          : field === 'priority'
            ? record.baseEdge?.priority
            : field === 'isDefault'
              ? record.baseEdge?.isDefault
              : field === 'label'
                ? record.baseEdge?.label
                : undefined,
    after: field === 'source'
      ? record.compareEdge?.source
      : field === 'target'
        ? record.compareEdge?.target
        : field === 'condition'
          ? record.compareEdge?.condition
          : field === 'priority'
            ? record.compareEdge?.priority
            : field === 'isDefault'
              ? record.compareEdge?.isDefault
              : field === 'label'
                ? record.compareEdge?.label
                : undefined,
  }));
}
