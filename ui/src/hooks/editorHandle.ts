import { applyChangeSetChecked } from '../changeset/applyChangeSet.ts';
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

/** Imperative API exposed through the `ref` prop of `WorkflowEditor`. No method throws. */
export interface WorkflowEditorHandle {
    /** Stages a change set for review, replacing (and withdrawing) any staged proposal. */
    propose(changeSet: ChangeSet): ProposeResult;
    /** Applies a change set immediately as one undoable step tagged with its author. */
    apply(changeSet: ChangeSet): ApplyResult;
    /** Removes the staged proposal if its id matches. */
    withdraw(id: string): void;
    /** Replaces the whole document as one undoable step; exits simulation first. */
    replace(workflow: Workflow, origin?: Origin): void;
    /** Removes the highlight left by the last applied change set. */
    clearHighlights(): void;
    /** Returns a detached copy of the current document, revision, selection and problems. */
    getSnapshot(): EditorSnapshot;
}

/** Live accessors the handle needs; the component supplies React-backed ones, tests supply plain ones. */
export interface HandleAccess {
    state(): EditorState;
    dispatch(command: EditorCommand): void;
    readOnly(): boolean;
    problems(): ValidationProblem[];
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
            const state = access.state();
            const result = applyChangeSetChecked(state.document, changeSet, state.contentRevision);
            if (!result.ok) return { status: 'rejected', error: result.error };
            access.dispatch({ type: 'propose', changeSet: structuredClone(changeSet), preview: result.workflow });
            return { status: 'staged' };
        },
        apply(changeSet) {
            if (access.readOnly()) {
                return { status: 'rejected', error: { code: 'read-only', reason: 'The editor is read-only' } };
            }
            const state = access.state();
            const result = applyChangeSetChecked(state.document, changeSet, state.contentRevision);
            if (!result.ok) return { status: 'rejected', error: result.error };
            access.dispatch({ type: 'applyChangeSet', changeSet: structuredClone(changeSet) });
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
    };
}
