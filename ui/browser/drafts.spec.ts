import { test, expect, changes, field, ready, waitForViewportChange } from './test.ts';

for (const id of ['a', 'h']) {
    test(`${id} value typing preserves DOM identity/caret and coalesces nested config history with empty-key drafts`, async ({ page }) => {
        await page.goto('/?echo');
        const editor = page.getByTestId('one');
        await ready(editor);
        await editor.locator(`.react-flow__node[data-id="${id}"]`).click();
        const keys = editor.getByPlaceholder('Label', { exact: true });
        const values = editor.getByPlaceholder(id === 'a' ? 'e.g. context.loanAmount' : 'e.g. context.creditScore');
        const originalInputs = { first: 'context.first', count: 3, enabled: false, data: { nested: [1, null] } };
        const valueElement = await values.first().elementHandle();
        await values.first().press('End');
        for (const character of 'Value') {
            // Global keyboard delivery cannot silently refocus a remounted input between characters.
            await page.keyboard.type(character);
            expect(await valueElement!.evaluate(element => element === document.activeElement)).toBe(true);
        }
        await expect(values.first()).toHaveValue('context.firstValue');
        expect(await valueElement!.evaluate(element => ({
            connected: element.isConnected,
            start: (element as HTMLInputElement).selectionStart,
            end: (element as HTMLInputElement).selectionEnd,
        }))).toEqual({ connected: true, start: 18, end: 18 });
        const typed = await changes(editor);
        expect(typed).toHaveLength(5);
        for (const [index, document] of typed.entries()) {
            expect(document.nodes.find(node => node.id === id)?.config.inputs).toEqual({
                ...originalInputs, first: `context.first${'Value'.slice(0, index + 1)}`,
            });
        }
        await values.first().press('Tab');
        await editor.getByRole('button', { name: 'Undo', exact: true }).click();
        await expect(values.first()).toHaveValue('context.first');
        expect((await changes(editor)).at(-1)?.nodes.find(node => node.id === id)?.config.inputs).toEqual(originalInputs);
        await expect(editor.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();
        await editor.getByRole('button', { name: 'Redo', exact: true }).click();
        await expect(values.first()).toHaveValue('context.firstValue');
        expect((await changes(editor)).at(-1)?.nodes.find(node => node.id === id)?.config.inputs).toEqual({
            ...originalInputs, first: 'context.firstValue',
        });
        expect(await changes(editor)).toHaveLength(7);

        // Transition an existing populated row to an empty key, then create a colliding empty draft.
        await keys.first().fill('');
        await editor.getByRole('button', { name: '+ Add input', exact: true }).click();
        await values.last().pressSequentially('second empty value');
        const draftKeys = ['', 'count', 'enabled', 'data', ''];
        const draftValues = ['context.firstValue', '3', 'false', '{"nested":[1,null]}', 'second empty value'];
        expect(await keys.evaluateAll(elements => elements.map(element => (element as HTMLInputElement).value))).toEqual(draftKeys);
        expect(await values.evaluateAll(elements => elements.map(element => (element as HTMLInputElement).value))).toEqual(draftValues);
        await field(editor, 'Name').fill('Unrelated name');
        expect(await keys.evaluateAll(elements => elements.map(element => (element as HTMLInputElement).value))).toEqual(draftKeys);
        expect(await values.evaluateAll(elements => elements.map(element => (element as HTMLInputElement).value))).toEqual(draftValues);
        expect((await changes(editor)).at(-1)?.nodes.find(node => node.id === id)?.config.inputs).toEqual({
            '': 'second empty value', count: 3, enabled: false, data: { nested: [1, null] },
        });
    });

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
        // Make import's fit observable even for an equal document. Panel reset precedes the scheduled fit.
        await editor.getByRole('button', { name: 'Zoom Out', exact: true }).click();
        await editor.getByRole('button', { name: 'Zoom Out', exact: true }).click();
        const viewport = editor.locator('.react-flow__viewport');
        const beforeImport = await viewport.getAttribute('style');
        await editor.locator('input[type=file]').setInputFiles({ name: 'same.json', mimeType: 'application/json',
            buffer: Buffer.from(JSON.stringify(document)) });
        await expect(editor.locator('.properties-panel')).toContainText('Select a node');
        await waitForViewportChange(viewport, beforeImport);
        await editor.locator(`.react-flow__node[data-id="${id}"]`).click();
        await expect(editor.locator(`.react-flow__node[data-id="${id}"]`)).toHaveClass(/selected/);
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
