import type { ReactNode } from 'react';
import type { EditorSelection } from '../hooks/editorNotifications.ts';
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

/**
 * The Action Type catalog: a static list, or a function resolving to one. Pass a new array or function to
 * change the catalog; the editor reloads it and keeps the previous list visible until a function provider's
 * result arrives.
 */
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
  /**
   * Opens the host's Action Type editor. Called from the Properties panel's Open/Create… button, which is
   * shown only when this is provided. `resolved` is false when the value is not in the loaded catalog.
   */
  openActionType?: (request: { value: string; resolved: boolean }) => void;
  /** Optional host-provided additional validation (see {@link WorkflowValidator}). */
  validate?: WorkflowValidator;
  /**
   * Called each time a context menu opens on the canvas or a Problems panel row. Returns the host items
   * shown below the built-in ones. It is also called (silently) to decide whether a Problems row's actions
   * button is enabled: this probe runs when a row renders after the document, the problems, or the
   * read-only/simulation state change. Probe contexts share one workflow copy, so hosts must not mutate it.
   */
  contextActions?: (context: FlowContext) => ContextAction[];
}

/** What a context menu was opened on. */
export type FlowTarget =
  | { kind: 'canvas'; flowPosition: { x: number; y: number } }
  | { kind: 'node'; nodeId: string }
  | { kind: 'edge'; edgeId: string }
  | { kind: 'selection'; nodeIds: string[]; edgeIds: string[] }
  | { kind: 'problem'; problem: ValidationProblem };

/** Snapshot handed to `contextActions` and to the chosen action; built once per menu opening. */
export interface FlowContext {
  target: FlowTarget;
  /** Detached copy of the current document. */
  workflow: Workflow;
  /** Revision of `workflow`; use it as the `baseRevision` of change sets produced from this context. */
  contentRevision: string;
  /** Canvas selection when the menu opened, sorted by id. */
  selection: EditorSelection;
  /** Built-in and host problems shown in the Problems panel. */
  problems: ValidationProblem[];
  readOnly: boolean;
  /** Viewport (client) coordinates of the click, or the centre of the focused element for keyboard opens. */
  screenPosition: { x: number; y: number };
}

/** A host-defined context menu item. */
export interface ContextAction {
  id: string;
  label: string;
  icon?: ReactNode;
  danger?: boolean;
  disabled?: boolean;
  onSelect: (context: FlowContext) => void;
}
