import type { Locator } from '@playwright/test';
import { test, expect, ready } from './test.ts';

const log = async (editor: Locator) => JSON.parse(await editor.getByTestId('context-log').textContent() ?? '[]');
const node = (editor: Locator, id: string) => editor.locator(`.react-flow__node[data-id="${id}"]`);
const menu = (editor: Locator) => editor.getByRole('menu');
const items = (editor: Locator) => menu(editor).getByRole('menuitem');

test('node menu shows built-ins, a divider and host items, and passes the node context', async ({ page }) => {
    await page.goto('/?context');
    const editor = page.getByTestId('one');
    await ready(editor);
    await node(editor, 'a').click({ button: 'right' });
    await expect(items(editor)).toHaveText(['Clone', 'Delete', 'Ask AI about node', 'Not available']);
    await expect(menu(editor).getByRole('separator')).toHaveCount(1);
    await expect(items(editor).filter({ hasText: 'Not available' })).toBeDisabled();
    await items(editor).filter({ hasText: 'Ask AI about node' }).click();
    await expect(menu(editor)).toHaveCount(0);
    const [entry] = await log(editor);
    expect(entry).toMatchObject({ id: 'ask', target: { kind: 'node', nodeId: 'a' }, readOnly: false, nodes: 4 });
    expect(entry.contentRevision).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(entry.screenPosition.x).toBeGreaterThan(0);
});

test('edge and canvas menus pass their targets', async ({ page }) => {
    await page.goto('/?context');
    const editor = page.getByTestId('one');
    await ready(editor);
    await editor.getByRole('group', { name: 'Edge from s to a', exact: true }).click({ button: 'right' });
    await expect(items(editor)).toHaveText(['Delete', 'Ask AI about edge', 'Not available']);
    await items(editor).filter({ hasText: 'Ask AI about edge' }).click();
    await editor.locator('.react-flow__pane').click({ button: 'right', position: { x: 30, y: 30 } });
    await expect(items(editor)).toHaveText(['Ask AI about canvas', 'Not available']);
    await expect(menu(editor).getByRole('separator')).toHaveCount(0);
    await items(editor).filter({ hasText: 'Ask AI about canvas' }).click();
    const [edge, canvas] = await log(editor);
    expect(edge.target).toEqual({ kind: 'edge', edgeId: 'sa' });
    expect(canvas.target.kind).toBe('canvas');
    expect(typeof canvas.target.flowPosition.x).toBe('number');
});

test('right-clicking inside a multi-selection targets the whole selection', async ({ page }) => {
    await page.goto('/?context');
    const editor = page.getByTestId('one');
    await ready(editor);
    await node(editor, 'a').click();
    await node(editor, 'h').click({ modifiers: ['Control'] });
    await node(editor, 'h').click({ button: 'right' });
    await expect(items(editor)).toHaveText(['Delete', 'Ask AI about selection', 'Not available']);
    await items(editor).filter({ hasText: 'Ask AI about selection' }).click();
    expect((await log(editor))[0].target).toEqual({ kind: 'selection', nodeIds: ['a', 'h'], edgeIds: [] });
});

test('the menu opens from the keyboard, wraps, skips disabled items and restores focus', async ({ page }) => {
    await page.goto('/?context');
    const editor = page.getByTestId('one');
    await ready(editor);
    await node(editor, 'a').focus();
    await page.keyboard.press('Shift+F10');
    await expect(items(editor).filter({ hasText: 'Clone' })).toBeFocused();
    await page.keyboard.press('ArrowUp');
    await expect(items(editor).filter({ hasText: 'Ask AI about node' })).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(items(editor).filter({ hasText: 'Clone' })).toBeFocused();
    await page.keyboard.press('End');
    await expect(items(editor).filter({ hasText: 'Ask AI about node' })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(menu(editor)).toHaveCount(0);
    await expect(node(editor, 'a')).toBeFocused();
    await page.keyboard.press('Shift+F10');
    await page.keyboard.press('Enter');
    await expect(editor.locator('.react-flow__node')).toHaveCount(5);
});

test('a synthetic ContextMenu keydown on a focused edge opens its menu', async ({ page }) => {
    await page.goto('/?context');
    const editor = page.getByTestId('one');
    await ready(editor);
    const edge = editor.locator('.react-flow__edge[data-id="sa"]');
    await edge.focus();
    await expect(edge).toBeFocused();
    await edge.evaluate(element => element.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ContextMenu', bubbles: true, cancelable: true })));
    await expect(items(editor)).toHaveText(['Delete', 'Ask AI about edge', 'Not available']);
    await items(editor).filter({ hasText: 'Ask AI about edge' }).click();
    expect((await log(editor))[0].target).toEqual({ kind: 'edge', edgeId: 'sa' });
});

test('a read-only editor shows host items only', async ({ page }) => {
    await page.goto('/?context&readonly');
    const editor = page.getByTestId('one');
    await ready(editor);
    await node(editor, 'a').click({ button: 'right' });
    await expect(items(editor)).toHaveText(['Ask AI about node', 'Not available']);
    await items(editor).filter({ hasText: 'Ask AI about node' }).click();
    expect((await log(editor))[0].readOnly).toBe(true);
});

test('a failing host still leaves the built-in items', async ({ page, browserErrors }) => {
    await page.goto('/?context&contextThrow');
    const editor = page.getByTestId('one');
    await ready(editor);
    await node(editor, 'a').click({ button: 'right' });
    await expect(items(editor)).toHaveText(['Clone', 'Delete']);
    expect(browserErrors.some(message => message.includes('contextActions threw'))).toBe(true);
    browserErrors.length = 0;
});

test('with nothing to show, no menu opens', async ({ page }) => {
    await page.goto('/?context&contextEmpty&readonly');
    const editor = page.getByTestId('one');
    await ready(editor);
    await node(editor, 'a').click({ button: 'right' });
    await editor.locator('.react-flow__pane').click({ button: 'right', position: { x: 30, y: 30 } });
    await expect(menu(editor)).toHaveCount(0);
});

test('problem rows open host actions by right-click and from their actions button', async ({ page }) => {
    await page.goto('/?context');
    const editor = page.getByTestId('one');
    await ready(editor);
    const row = editor.locator('.problems-panel__item').filter({ hasText: 'MISSING_START_INPUTS' });
    await row.click({ button: 'right' });
    await expect(items(editor)).toHaveText(['Ask AI about problem', 'Not available']);
    await page.keyboard.press('Escape');
    await expect(menu(editor)).toHaveCount(0);
    await expect(row).toBeFocused();
    const button = row.getByRole('button', { name: 'Actions for MISSING_START_INPUTS' });
    await button.click();
    await items(editor).filter({ hasText: 'Ask AI about problem' }).click();
    const [entry] = await log(editor);
    expect(entry.target).toMatchObject({ kind: 'problem', problem: { code: 'MISSING_START_INPUTS', severity: 'warning' } });
    await expect(button).toBeFocused();
});

test('the problem actions button is absent without contextActions and disabled when the host has nothing', async ({ page }) => {
    await page.goto('/');
    let editor = page.getByTestId('one');
    await ready(editor);
    await expect(editor.locator('.problems-panel__menu')).toHaveCount(0);
    await page.goto('/?context&contextEmpty');
    editor = page.getByTestId('one');
    await ready(editor);
    await expect(editor.getByRole('button', { name: 'Actions for MISSING_START_INPUTS' })).toBeDisabled();
});
