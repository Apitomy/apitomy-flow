import { test, expect, changes, field, ready } from './test.ts';

for (const mode of ['simulation', 'manual lock']) {
    test(`${mode} rejects real drag, connect, palette drop, context menus and delete`, async ({ page }) => {
        await page.goto('/');
        const editor = page.getByTestId('one');
        await ready(editor);
        const action = editor.locator('.react-flow__node[data-id="a"]');
        await action.click();
        await field(editor, 'Name').fill('First');
        await field(editor, 'Name').press('Tab');
        await field(editor, 'Name').fill('Second');
        await editor.getByRole('button', { name: 'Undo', exact: true }).click();
        const before = await changes(editor);
        if (mode === 'simulation') {
            await editor.getByRole('switch').focus();
            await page.keyboard.press('Space');
        } else {
            await editor.getByRole('button', { name: 'Toggle Interactivity' }).click();
        }
        const position = await action.getAttribute('style');
        const box = (await action.boundingBox())!;
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await page.mouse.down();
        await page.mouse.move(box.x + box.width / 2 + 60, box.y + box.height / 2 + 50, { steps: 8 });
        await page.mouse.up();
        await expect(action).toHaveAttribute('style', position!);
        await action.click({ button: 'right' });
        await expect(editor.locator('.node-context-menu')).toHaveCount(0);
        const source = action.locator('.react-flow__handle.source');
        const target = editor.locator('.react-flow__node[data-id="e"] .react-flow__handle.target');
        await source.dragTo(target);
        const dataTransfer = await page.evaluateHandle(() => {
            const data = new DataTransfer();
            data.setData('application/reactflow-nodetype', 'wait');
            return data;
        });
        await editor.locator('.react-flow').dispatchEvent('drop', { dataTransfer, clientX: 250, clientY: 250 });
        await editor.locator('[data-workflow-editor]').focus();
        await page.keyboard.press('Delete');
        await page.keyboard.press('Backspace');
        if (mode === 'simulation') {
            await page.keyboard.press('Control+z');
            await page.keyboard.press('Control+y');
            await editor.getByRole('switch').focus();
            await page.keyboard.press('Space');
        } else {
            await editor.getByRole('button', { name: 'Toggle Interactivity' }).click();
        }
        expect(await changes(editor)).toEqual(before);
        await expect(editor.getByRole('button', { name: 'Undo', exact: true })).toBeEnabled();
        await expect(editor.getByRole('button', { name: 'Redo', exact: true })).toBeEnabled();
        await editor.getByRole('button', { name: 'Redo', exact: true }).click();
        await expect(field(editor, 'Name')).toHaveValue('Second');
    });
}

test('node plus independent selected edge deletion is one atomic transaction', async ({ page }) => {
    await page.goto('/');
    const editor = page.getByTestId('one');
    await ready(editor);
    await editor.locator('.react-flow__node[data-id="a"]').click();
    const independent = editor.getByRole('group', { name: 'Edge from h to e', exact: true });
    await independent.click({ modifiers: ['Control'] });
    await expect(editor.locator('.react-flow__node.selected')).toHaveCount(1);
    await expect(editor.locator('.react-flow__edge.selected')).toHaveCount(1);
    await independent.focus();
    await page.keyboard.press('Delete');
    await expect(editor.locator('.react-flow__node')).toHaveCount(3);
    await expect(editor.locator('.react-flow__edge')).toHaveCount(0);
    expect((await changes(editor)).length).toBe(1);
    await page.keyboard.press('Control+z');
    await expect(editor.locator('.react-flow__node')).toHaveCount(4);
    await expect(editor.locator('.react-flow__edge')).toHaveCount(3);
    await expect(editor.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();
});
