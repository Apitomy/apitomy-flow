import { type Workflow } from '../types/workflow.ts';
import { type ValidationProblem } from '../types/validation.ts';
import { validateWorkflow } from '../validation/validateWorkflow.ts';

/** Outcome of importing a workflow definition from JSON text. */
export interface ImportResult {
  /**
   * The imported workflow, present only when the text parsed into a structurally
   * valid definition with no error-severity validation problems. Left undefined
   * when the import is rejected so callers never render a broken graph.
   */
  workflow?: Workflow;
  /** Built-in validation problems found in the parsed definition. */
  problems: ValidationProblem[];
  /** Fatal message when the text could not be parsed/shaped into a workflow. */
  error?: string;
}

/** Serializes a workflow to pretty-printed, portable JSON. */
export function serializeWorkflow(workflow: Workflow): string {
  return JSON.stringify(workflow, null, 2);
}

/**
 * Parses and validates a workflow definition from JSON text.
 *
 * Import is deliberately defensive: malformed JSON or a structurally invalid
 * shape yields a fatal `error`, and an otherwise-parseable definition is run
 * through the built-in validation so problems are surfaced rather than a broken
 * graph being loaded silently. When error-severity problems are present the
 * `workflow` is withheld so callers refuse the import.
 */
export function parseWorkflow(text: string): ImportResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    return { problems: [], error: `Not valid JSON: ${(e as Error).message}` };
  }

  const shapeError = shapeProblem(raw);
  if (shapeError) {
    return { problems: [], error: shapeError };
  }

  const workflow = raw as Workflow;
  const problems = validateWorkflow(workflow);
  if (problems.some(p => p.severity === 'error')) {
    return { problems };
  }
  return { workflow, problems };
}

/** Returns a message describing the first structural problem, or undefined when the shape is acceptable. */
function shapeProblem(raw: unknown): string | undefined {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return 'A workflow definition must be a JSON object.';
  }
  const obj = raw as Record<string, unknown>;
  if (typeof obj.id !== 'string') return 'A workflow definition must have a string "id".';
  if (typeof obj.name !== 'string') return 'A workflow definition must have a string "name".';
  if (!Array.isArray(obj.nodes)) return 'A workflow definition must have a "nodes" array.';
  if (!Array.isArray(obj.edges)) return 'A workflow definition must have an "edges" array.';
  return undefined;
}

/** Builds a filesystem-friendly base filename (no extension) from a workflow's id/name. */
export function workflowFileName(workflow: Workflow): string {
  const base = (workflow.id || workflow.name || 'workflow')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return base || 'workflow';
}

/** Triggers a browser download of a data/object URL under the given file name. */
export function triggerDownload(fileName: string, url: string): void {
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

/** Triggers a browser download of the current workflow as a pretty-printed JSON file. */
export function downloadWorkflowJson(workflow: Workflow): void {
  const blob = new Blob([serializeWorkflow(workflow)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  triggerDownload(`${workflowFileName(workflow)}.json`, url);
  // Defer revocation so the download has a chance to start in all browsers.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
