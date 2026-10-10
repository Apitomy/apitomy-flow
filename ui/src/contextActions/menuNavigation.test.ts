import { describe, it, expect } from 'vitest';
import { clampMenuPosition, moveFocus } from './menuNavigation.ts';
import type { MenuEntry } from './menuItems.ts';

const item = (id: string, disabled = false): MenuEntry =>
    ({ type: 'item', id, label: id, danger: false, disabled, source: 'host', run: () => {} });
const divider: MenuEntry = { type: 'divider', id: 'divider' };
// Index:            0          1        2                3
const entries = [item('a'), divider, item('b', true), item('c')];

describe('moveFocus', () => {
    it('moves down and up over selectable items, skipping dividers and disabled items, wrapping', () => {
        expect(moveFocus(entries, 0, 'ArrowDown')).toBe(3);
        expect(moveFocus(entries, 3, 'ArrowDown')).toBe(0);
        expect(moveFocus(entries, 0, 'ArrowUp')).toBe(3);
        expect(moveFocus(entries, 3, 'ArrowUp')).toBe(0);
    });

    it('starts from nothing focused and jumps with Home and End', () => {
        expect(moveFocus(entries, -1, 'ArrowDown')).toBe(0);
        expect(moveFocus(entries, -1, 'ArrowUp')).toBe(3);
        expect(moveFocus(entries, 3, 'Home')).toBe(0);
        expect(moveFocus(entries, 0, 'End')).toBe(3);
    });

    it('returns -1 when nothing is selectable', () => {
        expect(moveFocus([divider, item('x', true)], -1, 'Home')).toBe(-1);
    });
});

describe('clampMenuPosition', () => {
    const bounds = { left: 0, top: 0, right: 500, bottom: 400 };
    it('keeps a fitting menu where it is', () => {
        expect(clampMenuPosition({ x: 10, y: 20 }, { width: 100, height: 80 }, bounds)).toEqual({ x: 10, y: 20 });
    });
    it('shifts a menu back inside the right and bottom edges', () => {
        expect(clampMenuPosition({ x: 450, y: 380 }, { width: 100, height: 80 }, bounds)).toEqual({ x: 400, y: 320 });
    });
    it('never moves above or left of the bounds, even when too large', () => {
        expect(clampMenuPosition({ x: 5, y: 5 }, { width: 900, height: 900 }, bounds)).toEqual({ x: 0, y: 0 });
    });
});
