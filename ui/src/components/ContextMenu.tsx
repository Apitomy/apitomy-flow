import { useLayoutEffect, useRef, type KeyboardEvent } from 'react';
import { runMenuEntry, type MenuEntry } from '../contextActions/menuItems.ts';
import { clampMenuPosition, moveFocus } from '../contextActions/menuNavigation.ts';
import './ContextMenu.css';

/** Props for {@link ContextMenu}. Keep `entries`, `position` and `bounds` stable while the menu is open. */
export interface ContextMenuProps {
  entries: MenuEntry[];
  /** Desired top-left corner in viewport coordinates. */
  position: { x: number; y: number };
  /** Area the menu must stay inside, in viewport coordinates (usually the editor's bounding box). */
  bounds: { left: number; top: number; right: number; bottom: number };
  /** Element to refocus on close, unless the chosen action moved focus elsewhere. */
  returnFocus: HTMLElement | SVGElement | null;
  onClose: () => void;
}

const NAVIGATION_KEYS = ['ArrowDown', 'ArrowUp', 'Home', 'End'] as const;
type NavigationKey = typeof NAVIGATION_KEYS[number];

const itemAt = (menu: HTMLElement, index: number) =>
  menu.querySelector<HTMLButtonElement>(`[data-menu-index="${index}"]`);

/** Accessible context menu: arrow/Home/End navigation, Enter/Space to choose, Escape or outside click to close. */
export function ContextMenu({ entries, position, bounds, returnFocus, onClose }: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  // Clamp after measuring and move focus into the menu, without a state update.
  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (!menu) return;
    const clamped = clampMenuPosition(position, { width: menu.offsetWidth, height: menu.offsetHeight }, bounds);
    menu.style.left = `${clamped.x}px`;
    menu.style.top = `${clamped.y}px`;
    const first = moveFocus(entries, -1, 'Home');
    (first >= 0 ? itemAt(menu, first) : menu)?.focus({ preventScroll: true });
  }, [entries, position, bounds]);

  const close = () => {
    const active = document.activeElement;
    const focusStillOurs = !active || active === document.body || !!menuRef.current?.contains(active);
    onClose();
    if (focusStillOurs && returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    // Keys pressed inside the menu never reach the editor's canvas shortcuts.
    event.stopPropagation();
    if (event.key === 'Escape' || event.key === 'Tab') {
      event.preventDefault();
      close();
      return;
    }
    if ((NAVIGATION_KEYS as readonly string[]).includes(event.key)) {
      event.preventDefault();
      const current = Number((document.activeElement as HTMLElement | null)?.dataset?.menuIndex ?? -1);
      const next = moveFocus(entries, current, event.key as NavigationKey);
      if (next >= 0 && menuRef.current) itemAt(menuRef.current, next)?.focus();
    }
  };

  return (
    <>
      <div className="flow-context-menu__backdrop" onClick={close}
        onContextMenu={event => { event.preventDefault(); close(); }} />
      <div ref={menuRef} className="flow-context-menu" role="menu" tabIndex={-1}
        style={{ left: position.x, top: position.y }} onKeyDown={onKeyDown}>
        {entries.map((entry, index) => entry.type === 'divider'
          ? <div key={entry.id} className="flow-context-menu__divider" role="separator" />
          : (
            <button key={entry.id} type="button" role="menuitem" tabIndex={-1} data-menu-index={index}
              disabled={entry.disabled}
              className={`flow-context-menu__item${entry.danger ? ' flow-context-menu__item--danger' : ''}`}
              onClick={() => { runMenuEntry(entry); close(); }}>
              {entry.icon && <span className="flow-context-menu__icon" aria-hidden="true">{entry.icon}</span>}
              {entry.label}
            </button>
          ))}
      </div>
    </>
  );
}
