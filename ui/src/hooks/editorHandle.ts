import { applyChangeSetChecked } from '../changeset/applyChangeSet.ts';
import { layoutAppliedChange, type AppliedChangeLayout } from '../changeset/appliedLayout.ts';
import type { ChangeSet, ChangeSetError, Origin } from '../changeset/types.ts';
import type { ValidationProblem } from '../types/validation.ts';
import type { Workflow } from '../types/workflow.ts';
import type { EditorCommand, EditorState } from './editorState.ts';
import { selectionOf, type EditorSelection } from './editorNotifications.ts';

/** Point-in-time view of the editor for building agent context and change sets. */
export interface EditorSnapshot {
    workflow: Workflow;
    contentRevision: string;
    selection: EditorSelection;
    problems: ValidationProblem[];
}

/** Result of {@link WorkflowEditorHandle.propose}. */
export type ProposeResult = { status: 'staged' } | { status: 'rejected'; error: ChangeSetError };

/** Result of {@link WorkflowEditorHandle.apply}. */
export type ApplyResult = { status: 'applied' } | { status: 'rejected'; error: ChangeSetError };

/** The element {@link WorkflowEditorHandle.select} targets. */
export interface SelectTarget {
    nodeId?: string;
    edgeId?: string;
}

/** Options for {@link WorkflowEditorHandle.select}. */
export interface SelectOptions {
    /** Pans and zooms the canvas onto the selected element, like clicking a Problems row. Defaults to `false`. */
    center?: boolean;
}

/** Imperative API exposed through the `ref` prop of `WorkflowEditor`. No method throws. */
export interface WorkflowEditorHandle {
    /** Stages a change set for review, replacing (and withdrawing) any staged proposal. Exits simulation first. */
    propose(changeSet: ChangeSet): ProposeResult;
    /** Applies a change set immediately as one undoable step tagged with its author. Exits simulation first. */
    apply(changeSet: ChangeSet): ApplyResult;
    /** Removes the staged proposal if its id matches. */
    withdraw(id: string): void;
    /**
     * Replaces the whole document as one undoable step; exits simulation first. `origin` defaults to
     * `'host'`. The workflow must be structured-cloneable (plain JSON data).
     */
    replace(workflow: Workflow, origin?: Origin): void;
    /**
     * Clears the canvas selection (selection flags and the primary selection). Applied change sets are now
     * shown by selecting their elements rather than highlighting them, so this simply deselects.
     *
     * @deprecated Applied changes are no longer highlighted; deselect via the canvas or {@link select} instead.
     */
    clearHighlights(): void;
    /**
     * Returns a detached copy of the current document, revision, selection and problems. The document
     * must be structured-cloneable, which holds for any workflow supplied as plain JSON data.
     */
    getSnapshot(): EditorSnapshot;
    /**
     * Selects a node or edge, highlighting it on the canvas and optionally centering it, the same way clicking a
     * Problems row does. Works in read-only editors and during simulation.
     *
     * - `null` clears the selection.
     * - An id that is not in the workflow is dropped, as with any selection; if nothing valid remains the
     *   selection is cleared (never an error) and the canvas does not move.
     * - Given both ids, both are recorded as the editor selection (as the internal `select` command does);
     *   the node is the one highlighted and centered on the canvas.
     * - `center` defaults to `false` so a host can change the selection without moving the user's viewport;
     *   pass `{ center: true }` to bring the element into view. An edge is centered by fitting both endpoints.
     *
     * @param target the node and/or edge to select, or `null` to clear
     * @param options centering behaviour
     */
    select(target: SelectTarget | null, options?: SelectOptions): void;
}

/** Live accessors the handle needs; the component supplies React-backed ones, tests supply plain ones. */
export interface HandleAccess {
    state(): EditorState;
    dispatch(command: EditorCommand): void;
    readOnly(): boolean;
    problems(): ValidationProblem[];
    /** Layout policy for change sets; defaults to `'place'`. */
    layout?(): AppliedChangeLayout;
    /** Whether applied change sets select their added and modified elements; defaults to true. */
    selectApplied?(): boolean;
    /**
     * Mirrors an editor selection onto the canvas (selection flags) and, when `center` is set, moves the
     * viewport onto it. `target` is the effective single element (`null` when nothing is selected).
     */
    reveal?(target: { nodeId: string } | { edgeId: string } | null, center: boolean): void;
}

type CheckedChangeSet =
    | { ok: true; changeSet: ChangeSet; workflow: Workflow }
    | { ok: false; error: ChangeSetError };

/**
 * Detaches the host's change set and checks it against the current document. Any thrown error (for
 * example a value that cannot be structured-cloned) is reported as a malformed change set.
 *
 * @param state the current editor state
 * @param changeSet the host-supplied change set
 * @returns the detached change set and resulting workflow, or the error
 */
function cloneAndCheck(state: EditorState, changeSet: ChangeSet): CheckedChangeSet {
    try {
        const copy = structuredClone(changeSet);
        const result = applyChangeSetChecked(state.document, copy, state.contentRevision);
        return result.ok ? { ok: true, changeSet: copy, workflow: result.workflow } : result;
    } catch (e) {
        return { ok: false, error: { code: 'malformed', reason: `Invalid change set: ${String(e)}` } };
    }
}

/**
 * Builds the editor handle. Results are computed from the same pure functions the reducer uses, so the
 * returned status always matches what the reducer does with the dispatched command.
 *
 * @param access live accessors for state, dispatch and validation
 * @returns the handle
 */
export function createEditorHandle(access: HandleAccess): WorkflowEditorHandle {
    return {
        propose(changeSet) {
            const checked = cloneAndCheck(access.state(), changeSet);
            if (!checked.ok) return { status: 'rejected', error: checked.error };
            access.dispatch({ type: 'propose', changeSet: checked.changeSet,
                preview: layoutAppliedChange(checked.workflow, checked.changeSet, access.layout?.() ?? 'place') });
            return { status: 'staged' };
        },
        apply(changeSet) {
            if (access.readOnly()) {
                return { status: 'rejected', error: { code: 'read-only', reason: 'The editor is read-only' } };
            }
            const checked = cloneAndCheck(access.state(), changeSet);
            if (!checked.ok) return { status: 'rejected', error: checked.error };
            access.dispatch({ type: 'applyChangeSet', changeSet: checked.changeSet, layout: access.layout?.() ?? 'place',
                selectApplied: access.selectApplied?.() ?? true });
            return { status: 'applied' };
        },
        withdraw(id) {
            access.dispatch({ type: 'withdraw', id });
        },
        replace(workflow, origin = 'host') {
            access.dispatch({ type: 'mode', simulating: false });
            access.dispatch({ type: 'import', workflow: structuredClone(workflow), origin });
        },
        clearHighlights() {
            access.dispatch({ type: 'clearHighlights' });
        },
        getSnapshot() {
            const state = access.state();
            return { workflow: structuredClone(state.document), contentRevision: state.contentRevision,
                selection: selectionOf(state), problems: structuredClone(access.problems()) };
        },
        select(target, options) {
            access.dispatch({ type: 'select', nodeId: target?.nodeId, edgeId: target?.edgeId });
            const { selectedNodeId, selectedEdgeId } = access.state();
            const effective = selectedNodeId ? { nodeId: selectedNodeId }
                : selectedEdgeId ? { edgeId: selectedEdgeId } : null;
            access.reveal?.(effective, effective ? options?.center === true : false);
        },
    };
}
