import { test, expect, ready, changes } from './test.ts';

for (const count of [8, 9]) {
    test(`Action Type catalog with ${count} entries preserves filtering, selection and custom creation`, async ({ page }) => {
        await page.goto(`/?async&actionCount=${count}`);
        const editor = page.getByTestId('one');
        await ready(editor);
        await editor.locator('.react-flow__node[data-id="a"]').click();
        await editor.getByRole('button', { name: 'Resolve action catalog', exact: true }).click();
        const input = editor.getByRole('textbox', { name: 'Type to filter' });
        await expect(input).toHaveAttribute('placeholder', count > 8
            ? 'Filter action types...' : 'Select or type an action type');
        await input.fill('NOTIFICATION');
        await expect(page.getByRole('option', { name: /^Action 0/ })).toBeVisible();
        await expect(page.getByRole('option', { name: /^Action [0-9]/ })).toHaveCount(count > 8 ? 1 : 8);
        await page.getByRole('option', { name: /^Action 0/ }).click();
        await expect(input).toHaveValue('Action 0');
        await expect.poll(async () => (await changes(editor)).at(-1)?.nodes.find(node => node.id === 'a')?.config.actionType)
            .toBe('action.0');

        await input.fill('host.custom');
        await expect(page.getByRole('option', { name: /^Action [0-9]/ })).toHaveCount(count > 8 ? 0 : 8);
        await page.getByRole('option', { name: 'Use custom type "host.custom"', exact: true }).click();
        await expect(input).toHaveValue('host.custom');
        await expect.poll(async () => (await changes(editor)).at(-1)?.nodes.find(node => node.id === 'a')?.config.actionType)
            .toBe('host.custom');
        await editor.getByRole('button', { name: 'Clear action type' }).click();
        await expect(input).toHaveValue('');
        await expect(input).toBeFocused();
    });
}
