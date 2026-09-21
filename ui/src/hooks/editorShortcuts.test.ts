import { describe, expect, it } from 'vitest';
import { editorShortcut } from './editorShortcuts.ts';

describe('editor shortcut policy', () => {
    it('handles platform undo/redo and selection deletion only for the owning editor', () => {
        expect(editorShortcut({ key: 'z', ctrlKey: true }, true, false, false)).toBe('undo');
        expect(editorShortcut({ key: 'Z', metaKey: true, shiftKey: true }, true, false, false)).toBe('redo');
        expect(editorShortcut({ key: 'y', ctrlKey: true }, true, false, false)).toBe('redo');
        expect(editorShortcut({ key: 'Delete' }, true, false, false)).toBe('delete');
        expect(editorShortcut({ key: 'Backspace' }, true, false, false)).toBe('delete');
        expect(editorShortcut({ key: 'z', ctrlKey: true }, false, false, false)).toBeNull();
    });

    it('leaves text editing, IME, consumed events, modified deletion, and simulation alone', () => {
        expect(editorShortcut({ key: 'z', ctrlKey: true }, true, true, false)).toBeNull();
        expect(editorShortcut({ key: 'Delete' }, true, false, true)).toBeNull();
        expect(editorShortcut({ key: 'z', ctrlKey: true, isComposing: true }, true, false, false)).toBeNull();
        expect(editorShortcut({ key: 'z', ctrlKey: true, defaultPrevented: true }, true, false, false)).toBeNull();
        expect(editorShortcut({ key: 'Delete', altKey: true }, true, false, false)).toBeNull();
        expect(editorShortcut({ key: 'z' }, true, false, false)).toBeNull();
    });
});
