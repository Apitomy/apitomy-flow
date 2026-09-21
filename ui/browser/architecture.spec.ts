import { test, expect, ready, field, changes } from './test.ts';

test('selection, layout and layout history do not reschedule semantic host validation', async ({ page }) => {
    await page.clock.install();
    await page.goto('/?async');
    const editor = page.getByTestId('one');
    await ready(editor);
    await page.clock.fastForward(1000);
    await expect(editor.getByTestId('validation-count')).toHaveText('1');
    await editor.locator('.react-flow__node[data-id="a"]').click();
    await editor.getByRole('button', { name: 'Tidy up' }).click();
    await editor.getByRole('button', { name: 'Undo', exact: true }).click();
    await editor.getByRole('button', { name: 'Redo', exact: true }).click();
    await page.clock.fastForward(1000);
    await expect(editor.getByTestId('validation-count')).toHaveText('1');
    await field(editor, 'Name').fill('Semantic change');
    await page.clock.fastForward(1000);
    await expect(editor.getByTestId('validation-count')).toHaveText('2');
});

test('human output forms preserve typed defaults and select options through undo', async ({ page }) => {
    await page.goto('/');
    const editor = page.getByTestId('one');
    await ready(editor);
    await editor.locator('.react-flow__node[data-id="h"]').click();
    await editor.getByRole('button', { name: '+ Add output', exact: true }).click();
    const output = editor.locator('.properties-panel__input-item').last();
    await output.getByPlaceholder('Name', { exact: true }).fill('answer');
    await output.getByRole('button', { name: /Advanced/ }).click();
    await output.locator('select').first().selectOption('number');
    await output.locator('input[type="number"]').fill('42');
    let config = (await changes(editor)).at(-1)!.nodes.find(node => node.id === 'h')!.config;
    expect(config.outputs).toMatchObject([{ name: 'answer', type: 'number', defaultValue: 42 }]);
    await output.locator('select').first().selectOption('string');
    await output.locator('select').nth(1).selectOption('select');
    await output.getByRole('button', { name: '+ Add option', exact: true }).click();
    await output.getByPlaceholder('Label', { exact: true }).fill('Yes');
    await output.getByPlaceholder('Value', { exact: true }).fill('yes');
    await output.locator('select').last().focus();
    await output.locator('select').last().selectOption('yes');
    config = (await changes(editor)).at(-1)!.nodes.find(node => node.id === 'h')!.config;
    expect(config.outputs).toMatchObject([{ defaultValue: 'yes', options: [{ label: 'Yes', value: 'yes' }] }]);
    await editor.getByRole('button', { name: 'Undo', exact: true }).click();
    config = (await changes(editor)).at(-1)!.nodes.find(node => node.id === 'h')!.config;
    expect(config.outputs).toMatchObject([{ defaultValue: 42, options: [{ label: 'Yes', value: 'yes' }] }]);
});
