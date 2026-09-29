import { test, expect, changes, completeGraphs, field, ready } from './test.ts';
import { importedWorkflow } from './fixtures.ts';

test('edge label/condition typing coalesces; checkbox toggles and add/remove controls are separate history entries', async ({ page }) => {
    await page.goto('/');
    const editor = page.getByTestId('one');
    await ready(editor);
    await editor.getByRole('group', { name: 'Edge from a to h', exact: true }).click();
    const label = field(editor, 'Label');
    await label.pressSequentially('Approved');
    await label.press('Tab');
    await editor.getByRole('button', { name: 'Undo', exact: true }).click();
    await expect(label).toHaveValue('');
    await expect(editor.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();
    await editor.getByRole('button', { name: 'Redo', exact: true }).click();
    await expect(label).toHaveValue('Approved');
    const condition = editor.locator('.properties-panel textarea').first();
    await condition.pressSequentially('context.approved == true');
    await condition.press('Tab');
    await editor.getByRole('button', { name: 'Undo', exact: true }).click();
    await expect(condition).toHaveValue('');
    await expect(label).toHaveValue('Approved');
    await editor.getByRole('button', { name: 'Redo', exact: true }).click();
    const fallback = editor.getByRole('checkbox', { name: /Default edge/ });
    await fallback.check();
    await fallback.uncheck();
    await editor.getByRole('button', { name: 'Undo', exact: true }).click();
    await expect(fallback).toBeChecked();
    await editor.getByRole('button', { name: 'Undo', exact: true }).click();
    await expect(fallback).not.toBeChecked();
    await editor.locator('.react-flow__node[data-id="h"]').click();
    await editor.getByRole('button', { name: '+ Add output', exact: true }).click();
    await editor.getByRole('button', { name: '+ Add output', exact: true }).click();
    await expect(editor.getByTitle('Remove output')).toHaveCount(2);
    await editor.getByRole('button', { name: 'Undo', exact: true }).click();
    await expect(editor.getByTitle('Remove output')).toHaveCount(1);
    await editor.getByRole('button', { name: 'Undo', exact: true }).click();
    await expect(editor.getByTitle('Remove output')).toHaveCount(0);
    completeGraphs(await changes(editor));
});

test('multi-selection deletion removes all incident edges atomically and focused edge deletion restores focus', async ({ page }) => {
    await page.goto('/?two');
    const editor = page.getByTestId('one');
    await ready(editor);
    await editor.locator('.react-flow__node[data-id="a"]').click();
    await editor.locator('.react-flow__node[data-id="h"]').click({ modifiers: ['Control'] });
    await expect(editor.locator('.react-flow__node.selected')).toHaveCount(2);
    await editor.locator('.react-flow__node[data-id="h"]').focus();
    await page.keyboard.press('Delete');
    await expect(editor.locator('.react-flow__node')).toHaveCount(2);
    expect((await changes(editor)).length).toBe(1);
    expect((await changes(editor))[0].edges).toEqual([]);
    await page.keyboard.press('Control+z');
    await expect(editor.locator('.react-flow__node')).toHaveCount(4);
    await expect(editor.locator('.react-flow__edge')).toHaveCount(3);
    const edge = editor.getByRole('group', { name: 'Edge from h to e', exact: true });
    await edge.click();
    await edge.focus();
    await page.keyboard.press('Backspace');
    await expect(editor.locator('.react-flow__edge')).toHaveCount(2);
    await expect(editor.locator('[data-workflow-editor]')).toBeFocused();
    await page.keyboard.press('Control+z');
    await expect(editor.locator('.react-flow__edge')).toHaveCount(3);
    await expect(page.getByTestId('two').getByTestId('changes')).toHaveText('[]');
    completeGraphs(await changes(editor));
});

test('selected-group drag commits once after release and keyboard movement remains undoable', async ({ page }) => {
    await page.goto('/');
    const editor = page.getByTestId('one');
    await ready(editor);
    const action = editor.locator('.react-flow__node[data-id="a"]');
    await action.click();
    await editor.locator('.react-flow__node[data-id="h"]').click({ modifiers: ['Control'] });
    await expect(editor.locator('.react-flow__node.selected')).toHaveCount(2);
    const box = (await action.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 40, box.y + box.height / 2 + 60, { steps: 10 });
    expect(await changes(editor)).toEqual([]);
    await page.mouse.up();
    await expect.poll(async () => (await changes(editor)).length).toBe(1);
    const moved = (await changes(editor))[0];
    expect(moved.nodes[1].position!.x).not.toBe(230);
    expect(moved.nodes[2].position!.x).not.toBe(460);
    await editor.getByRole('button', { name: 'Undo', exact: true }).click();
    expect((await changes(editor)).at(-1)?.nodes[1].position).toEqual({ x: 230, y: 20 });
    expect((await changes(editor)).at(-1)?.nodes[2].position).toEqual({ x: 460, y: 160 });
    await editor.getByRole('button', { name: 'Redo', exact: true }).click();
    expect((await changes(editor)).at(-1)).toEqual(moved);
    await action.focus();
    await page.keyboard.press('ArrowRight');
    await expect.poll(async () => (await changes(editor)).length).toBe(4);
    await page.keyboard.press('Control+z');
    expect((await changes(editor)).at(-1)).toEqual(moved);
});

test('late real FileReader completion started before simulation cannot mutate document or history', async ({ page }) => {
    // Only gate the delivery of the real file read. File content/parsing, DOM input, reducer and React stay real.
    await page.addInitScript(() => {
        const read = FileReader.prototype.readAsText;
        FileReader.prototype.readAsText = function (...args) {
            const onload = this.onload;
            this.onload = event => {
                document.addEventListener('release-file', () => onload?.call(this, event), { once: true });
                document.documentElement.dataset.fileReady = 'true';
            };
            read.apply(this, args);
        };
    });
    await page.goto('/');
    const editor = page.getByTestId('one');
    await ready(editor);
    await editor.locator('.react-flow__node[data-id="a"]').click();
    await field(editor, 'Name').fill('Before simulation');
    await editor.locator('input[type=file]').setInputFiles({ name: 'late.json', mimeType: 'application/json',
        buffer: Buffer.from(JSON.stringify(importedWorkflow())) });
    await expect(page.locator('html')).toHaveAttribute('data-file-ready', 'true');
    await editor.getByRole('switch').focus();
    await page.keyboard.press('Space');
    await page.evaluate(() => document.dispatchEvent(new Event('release-file')));
    await editor.getByRole('switch').focus();
    await page.keyboard.press('Space');
    expect((await changes(editor)).length).toBe(1);
    await expect(field(editor, 'Name')).toHaveValue('Before simulation');
    await editor.getByRole('button', { name: 'Undo', exact: true }).click();
    await expect(field(editor, 'Name')).toHaveValue('Action');
    await expect(editor.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();
});

test('nested task-description typing is one document undo/redo transaction', async ({ page }) => {
    await page.goto('/?echo');
    const editor = page.getByTestId('one');
    await ready(editor);
    await editor.locator('.react-flow__node[data-id="h"]').click();
    const description = editor.getByPlaceholder('Instructions for the person completing this task');
    await description.press('End');
    await page.keyboard.type(' extended');
    await expect(description).toHaveValue('Review request extended');
    await expect(description).toBeFocused();
    expect((await changes(editor)).at(-1)?.nodes[2].config.description).toBe('Review request extended');
    await description.press('Tab');
    await editor.getByRole('button', { name: 'Undo', exact: true }).click();
    await expect(description).toHaveValue('Review request');
    expect((await changes(editor)).at(-1)?.nodes[2].config.description).toBe('Review request');
    await expect(editor.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();
    await editor.getByRole('button', { name: 'Redo', exact: true }).click();
    await expect(description).toHaveValue('Review request extended');
    expect((await changes(editor)).at(-1)?.nodes[2].config.description).toBe('Review request extended');
});

for (const kind of ['textarea', 'input'] as const) {
    test(`native ${kind} undo/redo changes text while retaining a newer document operation`, async ({ page }) => {
        await page.goto('/?two');
        const editor = page.getByTestId('one');
        await ready(editor);
        await editor.locator('.react-flow__node[data-id="h"]').click();
        const text = kind === 'textarea'
            ? editor.getByPlaceholder('Instructions for the person completing this task') : field(editor, 'Name');
        const original = kind === 'textarea' ? 'Review request' : 'Review';
        await text.press('End');
        await page.keyboard.insertText(' native edit');
        await expect(text).toHaveValue(`${original} native edit`);
        await editor.getByRole('button', { name: '+ Add output', exact: true }).click();
        const before = await changes(editor);
        expect(before).toHaveLength(2);
        expect(before[1].nodes[2].config.outputs).toEqual([{ name: '', type: 'string', required: true }]);
        await text.click();
        await page.keyboard.press('Control+z');
        await expect(text).toBeFocused();
        await expect(text).toHaveValue(original);
        await expect(editor.getByTitle('Remove output')).toHaveCount(1);
        const afterUndo = await changes(editor);
        expect(afterUndo).toHaveLength(3);
        const nativeUndo = structuredClone(before[1]);
        if (kind === 'textarea') nativeUndo.nodes[2].config.description = original;
        else nativeUndo.nodes[2].name = original;
        expect(afterUndo[2]).toEqual(nativeUndo);
        // A native input edit creates a new document transaction, not the document redo branch.
        await expect(editor.getByRole('button', { name: 'Redo', exact: true })).toBeDisabled();
        await page.keyboard.press('Control+Shift+z');
        await expect(text).toBeFocused();
        await expect(text).toHaveValue(`${original} native edit`);
        await expect(editor.getByTitle('Remove output')).toHaveCount(1);
        expect(await changes(editor)).toHaveLength(4);
        expect((await changes(editor)).at(-1)).toEqual(before[1]);
        await expect(page.getByTestId('two').getByTestId('changes')).toHaveText('[]');
    });
}

test('keyboard-accessible toolbar and native select retain focus and shortcut ownership', async ({ page }) => {
    await page.goto('/?two');
    const editor = page.getByTestId('one');
    await ready(editor);
    await editor.locator('.react-flow__node[data-id="h"]').click();
    await editor.getByRole('button', { name: '+ Add output', exact: true }).click();
    const type = editor.locator('.properties-panel select');
    await type.selectOption('number');
    await type.focus();
    await page.keyboard.press('Control+z');
    await page.keyboard.press('Delete');
    // Chromium may apply native undo to the previous textarea even with a select focused.
    // It must not undo the editor's latest output-type transaction or delete the selected node.
    await expect(type).toHaveValue('number');
    await expect(editor.locator('.react-flow__node')).toHaveCount(4);
    await type.selectOption('boolean');
    await editor.getByRole('button', { name: 'Undo', exact: true }).focus();
    await page.keyboard.press('Tab');
    await expect(editor.getByRole('button', { name: 'Tidy up', exact: true })).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(editor.getByRole('button', { name: 'Undo', exact: true })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(type).toHaveValue('number');
    await expect(page.getByTestId('two').getByTestId('changes')).toHaveText('[]');
});
