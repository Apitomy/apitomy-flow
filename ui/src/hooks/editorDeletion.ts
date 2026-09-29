import type { EditorCommand, EditorState } from './editorState.ts';

type DeleteCommand = Extract<EditorCommand, { type: 'delete' }>;

/** Transfers keyboard ownership to the surviving root before deleting graph elements. */
export function deleteWithEditorFocus(
    state: EditorState,
    command: DeleteCommand,
    root: { focus: (options: { preventScroll: boolean }) => void } | null,
    dispatch: (command: EditorCommand) => void,
): void {
    if (state.simulating || !state.interactive) return;
    const removesElement = state.document.nodes.some(node => command.nodeIds?.includes(node.id))
        || state.document.edges.some(edge => command.edgeIds?.includes(edge.id));
    if (!removesElement) return;
    root?.focus({ preventScroll: true });
    dispatch(command);
}
