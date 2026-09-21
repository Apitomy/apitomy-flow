interface ShortcutEvent {
    key: string;
    ctrlKey?: boolean;
    metaKey?: boolean;
    shiftKey?: boolean;
    altKey?: boolean;
    isComposing?: boolean;
    defaultPrevented?: boolean;
}

/** Resolves a key only when it belongs to an editable editor canvas rather than a text control. */
export function editorShortcut(
    event: ShortcutEvent, owned: boolean, textEditing: boolean, simulating: boolean,
): 'undo' | 'redo' | 'delete' | null {
    if (!owned || textEditing || simulating || event.defaultPrevented || event.isComposing || event.altKey) return null;
    const key = event.key.toLowerCase();
    if (event.ctrlKey || event.metaKey) {
        if (key === 'z') return event.shiftKey ? 'redo' : 'undo';
        if (key === 'y') return 'redo';
    } else if (!event.shiftKey && (key === 'delete' || key === 'backspace')) {
        return 'delete';
    }
    return null;
}
