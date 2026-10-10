import { test, expect, ready } from './test.ts';

test('an Action Type missing from the catalog is marked until the host adds it', async ({ page }) => {
    await page.goto('/?catalog');
    const editor = page.getByTestId('one');
    await ready(editor);
    const node = editor.locator('.react-flow__node[data-id="a"]');
    const marker = node.getByLabel('Unknown Action Type: noop');
    await expect(marker).toBeVisible();
    await node.click();
    await expect(editor.getByText('Not in the catalog yet')).toBeVisible();
    await editor.getByRole('button', { name: 'Add noop to catalog' }).click();
    await expect(marker).toHaveCount(0);
    await expect(editor.getByText('Not in the catalog yet')).toHaveCount(0);
});

test('nothing is marked without a catalog', async ({ page }) => {
    await page.goto('/');
    const editor = page.getByTestId('one');
    await ready(editor);
    await expect(editor.locator('.flow-node-unresolved')).toHaveCount(0);
});

test('Create… and Open call the host with the Action Type and whether it resolved', async ({ page }) => {
    await page.goto('/?catalog');
    const editor = page.getByTestId('one');
    await ready(editor);
    await editor.locator('.react-flow__node[data-id="a"]').click();
    await editor.getByRole('button', { name: 'Create…', exact: true }).click();
    await editor.getByRole('button', { name: 'Add noop to catalog' }).click();
    await editor.getByRole('button', { name: 'Open', exact: true }).click();
    expect(JSON.parse(await editor.getByTestId('open-requests').textContent() ?? '[]')).toEqual([
        { value: 'noop', resolved: false }, { value: 'noop', resolved: true },
    ]);
});

test('the button is absent without openActionType', async ({ page }) => {
    await page.goto('/?catalog&noOpen');
    const editor = page.getByTestId('one');
    await ready(editor);
    await editor.locator('.react-flow__node[data-id="a"]').click();
    await expect(editor.getByRole('button', { name: /^(Open|Create…)$/ })).toHaveCount(0);
});

test('the button works in a read-only editor', async ({ page }) => {
    await page.goto('/?catalog&readonly');
    const editor = page.getByTestId('one');
    await ready(editor);
    await editor.locator('.react-flow__node[data-id="a"]').click();
    await editor.getByRole('button', { name: 'Create…', exact: true }).click();
    expect(JSON.parse(await editor.getByTestId('open-requests').textContent() ?? '[]')).toEqual([
        { value: 'noop', resolved: false },
    ]);
});
