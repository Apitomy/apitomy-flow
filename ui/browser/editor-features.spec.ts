import type { Locator } from '@playwright/test';
import { test, expect, ready } from './test.ts';

const control = (editor: Locator, name: 'Import' | 'Export' | 'Image') =>
    editor.locator('.workflow-editor__toolbar').getByRole('button', { name, exact: true });
const simulate = (editor: Locator) => editor.getByRole('switch', { name: /Simulate routing/ });
const visible = async (editor: Locator) => ({
    import: await control(editor, 'Import').count(), export: await control(editor, 'Export').count(),
    image: await control(editor, 'Image').count(), simulate: await simulate(editor).count(),
});

test('all four features are shown by default', async ({ page }) => {
    await page.goto('/');
    const editor = page.getByTestId('one');
    await ready(editor);
    expect(await visible(editor)).toEqual({ import: 1, export: 1, image: 1, simulate: 1 });
});

for (const feature of ['import', 'export', 'image', 'simulate'] as const) {
    test(`features.${feature} = false hides only that control`, async ({ page }) => {
        await page.goto(`/?features=${feature}`);
        const editor = page.getByTestId('one');
        await ready(editor);
        const expected = { import: 1, export: 1, image: 1, simulate: 1, [feature]: 0 };
        expect(await visible(editor)).toEqual(expected);
    });
}

test('turning simulate off during a run ends the simulation', async ({ page }) => {
    await page.goto('/?features=');
    const editor = page.getByTestId('one');
    await ready(editor);
    await simulate(editor).click({ force: true });
    await expect(editor.locator('.workflow-editor__canvas--simulating')).toHaveCount(1);
    await editor.getByRole('button', { name: 'Turn off simulate' }).click();
    await expect(editor.locator('.workflow-editor__canvas--simulating')).toHaveCount(0);
    await expect(simulate(editor)).toHaveCount(0);
    await expect(editor.locator('.properties-panel')).toBeVisible();
});

test('read-only still hides Import and Simulate whatever features says', async ({ page }) => {
    await page.goto('/?features=image&readonly');
    const editor = page.getByTestId('one');
    await ready(editor);
    expect(await visible(editor)).toEqual({ import: 0, export: 1, image: 0, simulate: 0 });
});
