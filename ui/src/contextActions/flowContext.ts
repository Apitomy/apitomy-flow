import type { EditorState } from '../hooks/editorState.ts';
import { selectionOf, type EditorSelection } from '../hooks/editorNotifications.ts';
import type { FlowContext, FlowTarget } from '../types/spi.ts';
import type { ValidationProblem } from '../types/validation.ts';

/** What the user opened a menu on, before multi-selection is taken into account. */
export type MenuSubject = Exclude<FlowTarget, { kind: 'selection' }>;

/**
 * Maps the clicked element to a menu target: clicking inside a selection of two or more elements targets
 * the whole selection, otherwise the clicked element.
 *
 * @param subject the element the menu was opened on
 * @param selection the current canvas selection
 * @returns a fresh target object
 */
export function menuTarget(subject: MenuSubject, selection: EditorSelection): FlowTarget {
    if (subject.kind === 'node' || subject.kind === 'edge') {
        const size = selection.nodeIds.length + selection.edgeIds.length;
        const inside = subject.kind === 'node'
            ? selection.nodeIds.includes(subject.nodeId) : selection.edgeIds.includes(subject.edgeId);
        if (size >= 2 && inside) {
            return { kind: 'selection', nodeIds: [...selection.nodeIds], edgeIds: [...selection.edgeIds] };
        }
    }
    return structuredClone(subject);
}

/**
 * Builds the context snapshot for one menu opening. Everything is copied, so hosts may keep or mutate it.
 *
 * @param state the editor state at the moment the menu opens
 * @param target the menu target
 * @param problems problems currently shown in the Problems panel
 * @param readOnly whether the editor is read-only
 * @param screenPosition viewport coordinates used to anchor host UI
 * @returns the context
 */
export function buildFlowContext(state: EditorState, target: FlowTarget, problems: ValidationProblem[],
    readOnly: boolean, screenPosition: { x: number; y: number }): FlowContext {
    return {
        target: structuredClone(target),
        workflow: structuredClone(state.document),
        contentRevision: state.contentRevision,
        selection: selectionOf(state),
        problems: structuredClone(problems),
        readOnly,
        screenPosition: { ...screenPosition },
    };
}
