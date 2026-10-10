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
