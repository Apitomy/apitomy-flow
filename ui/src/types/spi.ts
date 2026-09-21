import { type Workflow } from './workflow.ts';
import { type ValidationProblem } from './validation.ts';

export interface ActionTypeField {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'object';
  required?: boolean;
  description?: string;
}

export interface ActionTypeDescriptor {
  value: string;
  label: string;
  description?: string;
  inputs?: ActionTypeField[];
  outputs?: ActionTypeField[];
}

export type ActionTypeProvider =
  | ActionTypeDescriptor[]
  | (() => Promise<ActionTypeDescriptor[]>);

/**
 * A host-provided validator invoked as the user authors a workflow. May run
 * synchronously or return a Promise (e.g. for server-backed checks). Its
 * problems are merged, additively, with the editor's built-in validation.
 *
 * Validation is semantic-only: selection, dragging, layout edits and layout-only
 * undo/redo do not invoke a stable validator again. Coordinates remain those from
 * the last semantic revision; the next semantic edit includes current coordinates.
 * Treat the supplied workflow as read-only and keep validation pure (do not mutate
 * the workflow or editor state). Use the current onChange document for
 * position-sensitive work, rather than this semantic validation hook.
 *
 * @param workflow the owned workflow snapshot from the current semantic revision
 * @returns host validation problems, or a Promise resolving to them
 */
export type WorkflowValidator =
  (workflow: Workflow) => ValidationProblem[] | Promise<ValidationProblem[]>;

export interface EditorSpi {
  actionTypes?: ActionTypeProvider;
  /** Optional host-provided additional validation (see {@link WorkflowValidator}). */
  validate?: WorkflowValidator;
}
