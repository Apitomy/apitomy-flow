import { test, expect, changes, field, ready } from './test.ts';

for (const id of ['a', 'h']) {
    test(`${id} map rows retain focus/caret, duplicate drafts and JSON literal values across cloned echoes`, async ({ page }) => {
        await page.goto('/?echo');
        const editor = page.getByTestId('one');
        await ready(editor);
        await editor.locator(`.react-flow__node[data-id="${id}"]`).click();
        const keys = editor.getByPlaceholder('Label', { exact: true });
        await keys.first().press('End');
        await keys.first().pressSequentially('LongKey');
        await expect(keys.first()).toBeFocused();
        expect(await keys.first().evaluate(element => (element as HTMLInputElement).selectionStart)).toBe(12);
        await keys.first().fill('count');
        await expect(keys).toHaveCount(4);
        await expect(editor.getByText('Duplicate key "count"', { exact: false })).toHaveCount(2);
        await editor.getByRole('button', { name: '+ Add input', exact: true }).click();
        await editor.getByRole('button', { name: '+ Add input', exact: true }).click();
        await expect(keys).toHaveCount(6);
        await field(editor, 'Name').fill('Unrelated edit');
        await expect(keys).toHaveCount(6);
        await field(editor, 'Node ID').press('End');
        await field(editor, 'Node ID').pressSequentially('renamed');
        await expect(keys).toHaveCount(6);
        const values = editor.getByPlaceholder(id === 'a' ? 'e.g. context.loanAmount' : 'e.g. context.creditScore');
        await expect(values.nth(1)).toHaveValue('3');
        await expect(values.nth(2)).toHaveValue('false');
        await expect(values.nth(3)).toHaveValue('{"nested":[1,null]}');
        const latest = (await changes(editor)).at(-1)!;
        expect(latest.nodes.find(node => node.id === `${id}renamed`)?.config.inputs).toMatchObject({
            count: 3, enabled: false, data: { nested: [1, null] },
        });
        // Retain the actual DOM identity of a surviving row when a non-last row is removed.
        const surviving = await keys.nth(3).elementHandle();
        await editor.getByTitle('Remove input', { exact: true }).nth(2).click();
        expect(await surviving?.evaluate(element => element.isConnected)).toBe(true);
        await keys.nth(2).press('End');
        await keys.nth(2).pressSequentially('Suffix');
        await expect(keys.nth(2)).toBeFocused();
        await expect(keys.nth(2)).toHaveValue('dataSuffix');
    });

    test(`${id} undo/redo, equal import and selection transitions explicitly reset duplicate drafts`, async ({ page }) => {
        await page.goto('/?echo');
        const editor = page.getByTestId('one');
        await ready(editor);
        await editor.locator(`.react-flow__node[data-id="${id}"]`).click();
        const keys = editor.getByPlaceholder('Label', { exact: true });
        await keys.first().fill('count');
        await field(editor, 'Name').fill('Another name');
        await expect(keys).toHaveCount(4);
        await editor.getByRole('button', { name: 'Undo', exact: true }).click();
        await expect(keys).toHaveCount(3);
        await editor.getByRole('button', { name: 'Redo', exact: true }).click();
        await expect(keys).toHaveCount(3);
        await editor.getByRole('button', { name: '+ Add input', exact: true }).click();
        await editor.getByRole('button', { name: '+ Add input', exact: true }).click();
        await expect(keys).toHaveCount(5);
        const document = (await changes(editor)).at(-1)!;
        await editor.locator('input[type=file]').setInputFiles({ name: 'same.json', mimeType: 'application/json',
            buffer: Buffer.from(JSON.stringify(document)) });
        await expect(editor.locator('.properties-panel')).toContainText('Select a node');
        await editor.locator(`.react-flow__node[data-id="${id}"]`).click();
        await expect(keys).toHaveCount(4);
        await editor.getByRole('button', { name: '+ Add input', exact: true }).click();
        await expect(keys).toHaveCount(5);
        await editor.locator(`.react-flow__node[data-id="${id === 'a' ? 'h' : 'a'}"]`).click();
        await expect(keys.first()).toHaveValue('first');
        await editor.locator(`.react-flow__node[data-id="${id}"]`).click();
        await expect(keys).toHaveCount(4);
    });
}

test('parent replacement follows mount-initialized graph contract; metadata updates retain drafts and remount replaces graph', async ({ page }) => {
    await page.goto('/');
    const editor = page.getByTestId('one');
    await ready(editor);
    await editor.locator('.react-flow__node[data-id="a"]').click();
    await editor.getByPlaceholder('Label', { exact: true }).first().fill('count');
    await editor.getByRole('button', { name: 'Replace props', exact: true }).click();
    await expect(editor.getByPlaceholder('Label', { exact: true })).toHaveCount(4);
    const current = (await changes(editor)).at(-1)!;
    expect(current).toMatchObject({ id: 'imported', version: 7, name: 'Imported' });
    expect(current.nodes[1].config.inputs).not.toHaveProperty('first');
    await editor.getByRole('button', { name: 'Remount', exact: true }).click();
    await expect(editor.locator('.properties-panel')).toContainText('Select a node');
    await editor.locator('.react-flow__node[data-id="a"]').click();
    await expect(editor.getByPlaceholder('Label', { exact: true }).first()).toHaveValue('first');
});
