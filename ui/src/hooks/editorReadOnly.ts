import type { EditorCommand } from './editorState.ts';

/**
 * Filters an editor command for a read-only editor. Commands that only affect presentation
 * (selection, leaving simulation mode, typing-group bookkeeping, host metadata sync, React Flow measurement)
 * pass through; anything that could mutate the workflow document returns {@code null}.
 *
 * @param command the command the editor wants to dispatch
 * @returns the (possibly narrowed) command to dispatch, or {@code null} to drop it
 */
export function readOnlyCommand(command: EditorCommand): EditorCommand | null {
    switch (command.type) {
        case 'select':
        case 'endGroup':
        case 'metadata':
            return command;
        case 'mode':
            // Simulation is unavailable when read-only; only leaving it is allowed. The interactivity
            // lock is meaningless when read-only.
            return command.simulating === false ? { type: 'mode', simulating: false } : null;
        case 'nodesChange': {
            const changes = command.changes.filter(change => change.type === 'select' || change.type === 'dimensions');
            return changes.length ? { type: 'nodesChange', changes } : null;
        }
        case 'edgesChange': {
            const changes = command.changes.filter(change => change.type === 'select');
            return changes.length ? { type: 'edgesChange', changes } : null;
        }
        default:
            return null;
    }
}
