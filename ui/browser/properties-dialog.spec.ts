import type { Locator } from '@playwright/test';
import { test, expect, ready, changes } from './test.ts';

const node = (editor: Locator, id: string) => editor.locator(`.react-flow__node[data-id="${id}"]`);

test('panel mode is unchanged: no Properties menu item and no dialog on double-click', async ({ page }) => {
    await page.goto('/');
    const editor = page.getByTestId('one');
    await ready(editor);
    await expect(editor.locator('.properties-panel')).toBeVisible();
    await node(editor, 'a').dblclick();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await node(editor, 'a').click({ button: 'right' });
    await expect(editor.getByRole('menuitem', { name: 'Properties' })).toHaveCount(0);
});

test('dialog mode hides the side panel and double-click opens live-editing properties', async ({ page }) => {
    await page.goto('/?dialog');
    const editor = page.getByTestId('one');
    await ready(editor);
    await expect(editor.locator('.properties-panel')).toHaveCount(0);
    await node(editor, 'a').dblclick();
    const dialog = page.getByRole('dialog', { name: 'Action: Action' });
    await expect(dialog).toBeVisible();
    const name = dialog.locator('.properties-panel__field').filter({ hasText: /^Name/ }).locator('input');
    await name.fill('Call Service');
    await expect(node(editor, 'a')).toContainText('Call Service');
    await expect(page.getByRole('dialog', { name: 'Action: Call Service' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    // Focus returns into the editor (PatternFly restores it to the node that opened the dialog).
    expect(await editor.locator('[data-workflow-editor]').evaluate(root => root.contains(document.activeElement))).toBe(true);
    await page.keyboard.press('Control+z');
    await expect(node(editor, 'a')).toContainText('Action');
    expect((await changes(editor)).at(-1)!.nodes.find(candidate => candidate.id === 'a')!.name).toBe('Action');
});

test('the dialog stays open while editing the node ID', async ({ page }) => {
    await page.goto('/?dialog');
    const editor = page.getByTestId('one');
    await ready(editor);
    await node(editor, 'a').dblclick();
    const dialog = page.getByRole('dialog');
    const id = dialog.locator('.properties-panel__field').filter({ hasText: /^Node ID/ }).locator('input');
    await id.fill('call');
    await expect(node(editor, 'call')).toBeVisible();
    await expect(dialog).toBeVisible();
    await expect(id).toHaveValue('call');
});

test('Properties in the node and edge context menus opens the dialog', async ({ page }) => {
    await page.goto('/?dialog');
    const editor = page.getByTestId('one');
    await ready(editor);
    await node(editor, 'h').click({ button: 'right' });
    await expect(editor.getByRole('menuitem')).toHaveText(['Properties', 'Clone', 'Delete']);
    await editor.getByRole('menuitem', { name: 'Properties' }).click();
    await expect(page.getByRole('dialog', { name: 'Human Task: Review' })).toBeVisible();
    await page.getByRole('dialog').locator('footer').getByRole('button', { name: 'Close', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(await editor.locator('[data-workflow-editor]').evaluate(root => root.contains(document.activeElement))).toBe(true);
    await editor.getByRole('group', { name: 'Edge from a to h', exact: true }).click({ button: 'right' });
    await editor.getByRole('menuitem', { name: 'Properties' }).click();
    await expect(page.getByRole('dialog', { name: 'Edge from Action to Review' })).toBeVisible();
});

test('read-only editors open the dialog with disabled fields', async ({ page }) => {
    await page.goto('/?dialog&readonly');
    const editor = page.getByTestId('one');
    await ready(editor);
    await node(editor, 'a').click({ button: 'right' });
    await expect(editor.getByRole('menuitem')).toHaveText(['Properties']);
    await editor.getByRole('menuitem', { name: 'Properties' }).click();
    await expect(page.getByRole('dialog').locator('fieldset[disabled]')).toHaveCount(1);
});

test('clicking a problem selects and centers its node without opening the dialog, as in panel mode', async ({ page }) => {
    await page.goto('/?dialog');
    const editor = page.getByTestId('one');
    await ready(editor);
    const viewport = editor.locator('.react-flow__viewport');
    const before = await viewport.getAttribute('style');
    await editor.locator('.problems-panel__item').filter({ hasText: 'MISSING_START_INPUTS' }).click();
    await expect.poll(() => viewport.getAttribute('style')).not.toBe(before);
    await page.waitForTimeout(400);
    await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('simulating restores the side panel for the simulation, and the dialog does not open', async ({ page }) => {
    await page.goto('/?dialog');
    const editor = page.getByTestId('one');
    await ready(editor);
    await editor.getByRole('switch', { name: /Simulate routing/ }).click({ force: true });
    await expect(editor.locator('.simulation-panel, [class*="simulation-panel"]').first()).toBeVisible();
    await node(editor, 'a').dblclick();
    await expect(page.getByRole('dialog')).toHaveCount(0);
});

test("an edge's label badge opens its properties like the edge itself", async ({ page }) => {
    await page.goto('/?dialog');
    const editor = page.getByTestId('one');
    await ready(editor);
    // Give edge a->h a label so it renders a badge on top of the edge.
    await editor.getByRole('group', { name: 'Edge from a to h', exact: true }).dblclick();
    const label = page.getByRole('dialog').locator('.properties-panel__field').filter({ hasText: /^Label/ }).locator('input');
    await label.fill('Approved');
    await page.keyboard.press('Escape');
    const badge = editor.locator('.edge-condition-badge').filter({ hasText: 'Approved' });
    await badge.dblclick();
    await expect(page.getByRole('dialog', { name: 'Edge from Action to Review' })).toBeVisible();
    await page.keyboard.press('Escape');
    await badge.click({ button: 'right' });
    await expect(editor.getByRole('menuitem')).toHaveText(['Properties', 'Delete']);
});

for (const [mode, query] of [['panel', '/'], ['dialog', '/?dialog']] as const) {
    test(`clicking a problem highlights its node as the only selection (${mode} mode)`, async ({ page }) => {
        await page.goto(query);
        const editor = page.getByTestId('one');
        await ready(editor);
        await node(editor, 'a').click();
        await expect(node(editor, 'a')).toHaveClass(/selected/);
        await editor.locator('.problems-panel__item').filter({ hasText: 'MISSING_START_INPUTS' }).click();
        await expect(node(editor, 's')).toHaveClass(/selected/);
        await expect(node(editor, 'a')).not.toHaveClass(/selected/);
    });
}

