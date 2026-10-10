import type { MenuEntry } from './menuItems.ts';

const selectable = (entry: MenuEntry) => entry.type === 'item' && !entry.disabled;

/**
 * Computes the next focused entry for a navigation key. Dividers and disabled items are skipped, and
 * arrows wrap around.
 *
 * @param entries the menu entries
 * @param current the focused index, or -1 when nothing is focused
 * @param key the navigation key
 * @returns the index to focus, or -1 when no entry is selectable
 */
export function moveFocus(entries: MenuEntry[], current: number, key: 'ArrowDown' | 'ArrowUp' | 'Home' | 'End'): number {
    const indices = entries.flatMap((entry, index) => (selectable(entry) ? [index] : []));
    if (!indices.length) return -1;
    if (key === 'Home') return indices[0];
    if (key === 'End') return indices[indices.length - 1];
    if (key === 'ArrowDown') return indices.find(index => index > current) ?? indices[0];
    return [...indices].reverse().find(index => current < 0 ? true : index < current) ?? indices[indices.length - 1];
}

/**
 * Shifts a menu so it stays inside the bounds, preferring to keep its top-left corner on screen.
 *
 * @param position desired top-left corner (viewport coordinates)
 * @param size the menu's rendered size
 * @param bounds the area the menu must stay within
 * @returns the clamped top-left corner
 */
export function clampMenuPosition(position: { x: number; y: number }, size: { width: number; height: number },
    bounds: { left: number; top: number; right: number; bottom: number }): { x: number; y: number } {
    return {
        x: Math.max(bounds.left, Math.min(position.x, bounds.right - size.width)),
        y: Math.max(bounds.top, Math.min(position.y, bounds.bottom - size.height)),
    };
}
