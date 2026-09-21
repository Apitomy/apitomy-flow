import { test, expect, changes, field, ready, completeGraphs } from './test.ts';
import { importedWorkflow, workflow } from './fixtures.ts';

test('StrictMode positioned mounts are silent; fallback layout publishes once and is not undoable', async ({ page }) => {
    await page.goto('/');
    const editor = page.getByTestId('one');
    await ready(editor);
    await expect(editor.getByTestId('changes')).toHaveText('[]');
    await editor.locator('.react-flow__node[data-id="a"]').click();
    await expect(editor.getByTestId('changes')).toHaveText('[]');
    await page.goto('/?positionless');
    await ready(editor);
    await expect.poll(async () => (await changes(editor)).length).toBe(1);
    const [laidOut] = await changes(editor);
    expect(new Set(laidOut.nodes.map(node => `${node.position!.x}:${node.position!.y}`)).size).toBe(4);
    await expect(editor.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();
});

for (const echo of [false, true]) {
    test(`property typing coalesces and rename keeps focus/endpoints (echo=${echo})`, async ({ page }) => {
        await page.goto(`/?${echo ? 'echo' : 'mutate'}`);
        const editor = page.getByTestId('one');
        await ready(editor);
        await editor.locator('.react-flow__node[data-id="a"]').click();
        const name = field(editor, 'Name');
        await name.press('End');
        await name.pressSequentially(' edited');
        await expect(name).toBeFocused();
        await name.press('Tab');
        await editor.getByRole('button', { name: 'Undo', exact: true }).click();
        await expect(name).toHaveValue('Action');
        await expect(editor.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();
        await editor.getByRole('button', { name: 'Redo', exact: true }).click();
        await expect(name).toHaveValue('Action edited');
        const nodeId = field(editor, 'Node ID');
        await nodeId.press('End');
        await nodeId.pressSequentially('renamed');
        await expect(nodeId).toBeFocused();
        await expect(nodeId).toHaveValue('arenamed');
        await nodeId.press('Tab');
        await editor.getByRole('button', { name: 'Undo', exact: true }).click();
        await expect(nodeId).toHaveValue('a');
        await editor.getByRole('button', { name: 'Redo', exact: true }).click();
        expect((await changes(editor)).at(-1)?.edges).toMatchObject([
            { source: 's', target: 'arenamed' }, { source: 'arenamed', target: 'h' }, { source: 'h', target: 'e' },
        ]);
        completeGraphs(await changes(editor));
    });

    test(`import restores metadata, resets selection and retains layout through undo/redo (echo=${echo})`, async ({ page }) => {
        await page.goto(echo ? '/?echo' : '/');
        const editor = page.getByTestId('one');
        await ready(editor);
        await editor.locator('.react-flow__node[data-id="a"]').click();
        await editor.locator('input[type=file]').setInputFiles({ name: 'import.json', mimeType: 'application/json',
            buffer: Buffer.from(JSON.stringify({ ...importedWorkflow(), host: { retained: true } })) });
        await expect.poll(async () => (await changes(editor)).length).toBe(1);
        await expect(editor.locator('.properties-panel')).toContainText('Select a node');
        const imported = (await changes(editor))[0];
        expect(imported).toMatchObject({ id: 'imported', name: 'Imported', version: 7,
            description: 'Imported description', host: { retained: true } });
        await editor.getByRole('button', { name: 'Undo', exact: true }).click();
        expect((await changes(editor)).at(-1)).toMatchObject({ id: 'original', name: 'Original', version: 1,
            description: 'Original description', nodes: workflow().nodes });
        await editor.getByRole('button', { name: 'Redo', exact: true }).click();
        expect((await changes(editor)).at(-1)).toEqual(imported);
        completeGraphs(await changes(editor));
    });
}

test('tidy and multi-frame drag each undo/redo exact final positions without drag-frame notifications', async ({ page }) => {
    await page.goto('/');
    const editor = page.getByTestId('one');
    await ready(editor);
    await editor.getByRole('button', { name: 'Tidy up', exact: true }).click();
    await expect.poll(async () => (await changes(editor)).length).toBe(1);
    const tidy = (await changes(editor))[0];
    expect(tidy.nodes.map(node => node.position)).not.toEqual(workflow().nodes.map(node => node.position));
    await editor.getByRole('button', { name: 'Undo', exact: true }).click();
    expect((await changes(editor)).at(-1)?.nodes).toEqual(workflow().nodes);
    await editor.getByRole('button', { name: 'Redo', exact: true }).click();
    expect((await changes(editor)).at(-1)).toEqual(tidy);
    const node = editor.locator('.react-flow__node[data-id="a"]');
    await node.click();
    const box = (await node.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 70, box.y + box.height / 2 + 90, { steps: 12 });
    expect((await changes(editor)).length).toBe(3);
    await page.mouse.up();
    await expect.poll(async () => (await changes(editor)).length).toBe(4);
    const dragged = (await changes(editor)).at(-1);
    expect(dragged?.nodes[1].position).not.toEqual(tidy.nodes[1].position);
    await editor.getByRole('button', { name: 'Undo', exact: true }).click();
    expect((await changes(editor)).at(-1)).toEqual(tidy);
    await editor.getByRole('button', { name: 'Redo', exact: true }).click();
    expect((await changes(editor)).at(-1)).toEqual(dragged);
});

test('focused delete and immediate keyboard undo/redo belong to one of two editors', async ({ page }) => {
    await page.goto('/?two');
    const one = page.getByTestId('one');
    const two = page.getByTestId('two');
    await ready(one);
    await ready(two);
    await two.locator('.react-flow__node[data-id="h"]').click();
    await one.locator('.react-flow__node[data-id="a"]').click();
    await one.locator('.react-flow__node[data-id="a"]').focus();
    await page.keyboard.press('Delete');
    await expect(one.locator('.react-flow__node')).toHaveCount(3);
    await expect(one.locator('[data-workflow-editor]')).toBeFocused();
    expect((await changes(one)).at(-1)?.edges.map(edge => edge.id)).toEqual(['he']);
    await page.keyboard.press('Control+z');
    await expect(one.locator('.react-flow__node')).toHaveCount(4);
    await page.keyboard.press('Control+Shift+z');
    await expect(one.locator('.react-flow__node')).toHaveCount(3);
    await page.keyboard.press('Control+z');
    await page.keyboard.press('Control+y');
    await expect(one.locator('.react-flow__node')).toHaveCount(3);
    await expect(two.getByTestId('changes')).toHaveText('[]');
    await two.locator('.react-flow__node[data-id="h"]').focus();
    await page.keyboard.press('Backspace');
    await expect(two.locator('.react-flow__node')).toHaveCount(3);
    await page.keyboard.press('Meta+z');
    await expect(two.locator('.react-flow__node')).toHaveCount(4);
    completeGraphs(await changes(one));
    completeGraphs(await changes(two));
});

test('context-menu deletion transfers focus before removal and keeps undo available', async ({ page }) => {
    await page.goto('/?two');
    const editor = page.getByTestId('one');
    await ready(editor);
    await editor.locator('.react-flow__node[data-id="a"]').click({ button: 'right' });
    await editor.getByRole('button', { name: /Delete/ }).click();
    await expect(editor.locator('[data-workflow-editor]')).toBeFocused();
    await expect(editor.locator('.react-flow__node')).toHaveCount(3);
    const deleted = await changes(editor);
    expect(deleted).toHaveLength(1);
    expect(deleted[0].nodes.map(node => node.id)).toEqual(['s', 'h', 'e']);
    expect(deleted[0].edges.map(edge => edge.id)).toEqual(['he']);
    await page.keyboard.press('Control+z');
    await expect(editor.locator('.react-flow__node')).toHaveCount(4);
    await expect(editor.locator('.react-flow__edge')).toHaveCount(3);
    expect(await changes(editor)).toHaveLength(2);
    expect((await changes(editor)).at(-1)).toEqual(workflow());
    await page.keyboard.press('Control+Shift+z');
    await expect(editor.locator('.react-flow__node')).toHaveCount(3);
    await expect(editor.locator('.react-flow__edge')).toHaveCount(1);
    expect(await changes(editor)).toHaveLength(3);
    expect((await changes(editor)).at(-1)).toEqual(deleted[0]);
    await expect(page.getByTestId('two').getByTestId('changes')).toHaveText('[]');
    completeGraphs(await changes(editor));
});

for (const kind of ['node', 'edge'] as const) {
    test(`Tab-first ${kind} selection and deletion keep scroll and undo ownership in the second editor`, async ({ page }) => {
        await page.goto('/?two');
        const one = page.getByTestId('one');
        const two = page.getByTestId('two');
        await ready(one);
        await ready(two);
        // Walk the actual browser tab sequence from the initial document focus. No click/focus shortcut.
        const firstNode = one.locator('.react-flow__node[data-id="a"]');
        for (let tab = 0; tab < 80 && !await firstNode.evaluate(element => element === document.activeElement); tab++) {
            await page.keyboard.press('Tab');
        }
        await expect(firstNode).toBeFocused();
        await page.keyboard.press('Enter');
        await expect(firstNode).toHaveClass(/selected/);
        const target = kind === 'node' ? two.locator('.react-flow__node[data-id="a"]')
            : two.getByRole('group', { name: 'Edge from a to h', exact: true });
        for (let tab = 0; tab < 80 && !await target.evaluate(element => element === document.activeElement); tab++) {
            await page.keyboard.press('Tab');
        }
        await expect(target).toBeFocused();
        await page.keyboard.press('Enter');
        await expect(target).toHaveClass(/selected/);
        await expect(firstNode).toHaveClass(/selected/);
        const scroll = await page.evaluate(() => ({ x: scrollX, y: scrollY }));
        expect(scroll.y).toBeGreaterThan(0);
        await page.keyboard.press('Delete');
        await expect(two.locator('[data-workflow-editor]')).toBeFocused();
        await expect(two.locator('.react-flow__node')).toHaveCount(kind === 'node' ? 3 : 4);
        await expect(two.locator('.react-flow__edge')).toHaveCount(kind === 'node' ? 1 : 2);
        const deleted = await changes(two);
        expect(deleted).toHaveLength(1);
        expect(deleted[0].nodes.map(node => node.id)).toEqual(kind === 'node' ? ['s', 'h', 'e'] : ['s', 'a', 'h', 'e']);
        expect(deleted[0].edges.map(edge => edge.id)).toEqual(kind === 'node' ? ['he'] : ['sa', 'he']);
        expect(await page.evaluate(() => ({ x: scrollX, y: scrollY }))).toEqual(scroll);
        await page.keyboard.press('Control+z');
        await expect(two.locator('.react-flow__node')).toHaveCount(4);
        await expect(two.locator('.react-flow__edge')).toHaveCount(3);
        expect(await changes(two)).toHaveLength(2);
        expect((await changes(two)).at(-1)).toEqual(workflow());
        await expect(two.locator('[data-workflow-editor]')).toBeFocused();
        expect(await page.evaluate(() => ({ x: scrollX, y: scrollY }))).toEqual(scroll);
        await page.keyboard.press('Control+Shift+z');
        await expect(two.locator('.react-flow__edge')).toHaveCount(kind === 'node' ? 1 : 2);
        expect(await changes(two)).toHaveLength(3);
        expect((await changes(two)).at(-1)).toEqual(deleted[0]);
        await expect(two.locator('[data-workflow-editor]')).toBeFocused();
        expect(await page.evaluate(() => ({ x: scrollX, y: scrollY }))).toEqual(scroll);
        await expect(firstNode).toHaveClass(/selected/);
        await expect(one.locator('.react-flow__node')).toHaveCount(4);
        await expect(one.locator('.react-flow__edge')).toHaveCount(3);
        await expect(one.getByTestId('changes')).toHaveText('[]');
        completeGraphs(await changes(two));
    });
}

test('host and property text focus excludes document shortcuts and simulation locks mutations', async ({ page }) => {
    await page.goto('/?two');
    const editor = page.getByTestId('one');
    await ready(editor);
    await editor.locator('.react-flow__node[data-id="h"]').click();
    await field(editor, 'Name').fill('Changed');
    await field(editor, 'Name').press('Delete');
    await page.getByRole('textbox', { name: 'Host text', exact: true }).fill('native');
    await page.keyboard.press('Control+z');
    await page.keyboard.press('Delete');
    await page.getByRole('textbox', { name: 'Host rich text' }).click();
    await page.keyboard.press('Backspace');
    expect((await changes(editor)).length).toBe(1);
    await editor.locator('.react-flow__node[data-id="h"]').click({ button: 'right' });
    await editor.getByRole('switch').focus();
    await page.keyboard.press('Space');
    await expect(editor.locator('.properties-panel')).toHaveCount(0);
    for (const name of ['Undo', 'Redo', 'Tidy up', 'Import']) {
        await expect(editor.getByRole('button', { name, exact: true })).toBeDisabled();
    }
    await expect(editor.getByRole('button', { name: /Delete/ })).toHaveCount(0);
    const switches = await page.getByRole('switch').evaluateAll(elements => elements.map(element => element.id));
    expect(new Set(switches).size).toBe(2);
    await editor.locator('[data-workflow-editor]').focus();
    for (const key of ['Control+z', 'Control+y', 'Delete', 'Backspace']) await page.keyboard.press(key);
    const transfer = await page.evaluateHandle(() => {
        const data = new DataTransfer();
        data.setData('application/reactflow-nodetype', 'action');
        return data;
    });
    await editor.locator('.react-flow').dispatchEvent('drop', { dataTransfer: transfer, clientX: 300, clientY: 300 });
    await editor.locator('input[type=file]').setInputFiles({ name: 'late.json', mimeType: 'application/json',
        buffer: Buffer.from(JSON.stringify(importedWorkflow())) });
    await expect(editor.getByRole('button', { name: 'Import', exact: true })).toBeDisabled();
    expect((await changes(editor)).length).toBe(1);
    await editor.getByRole('switch').focus();
    await page.keyboard.press('Space');
    await editor.getByRole('button', { name: 'Undo', exact: true }).click();
    await expect(field(editor, 'Name')).toHaveValue('Review');
    await editor.getByRole('button', { name: 'Toggle Interactivity' }).click();
    await expect(editor.getByRole('button', { name: 'Tidy up', exact: true })).toBeDisabled();
    await field(editor, 'Name').fill('Allowed while locked');
    await expect(field(editor, 'Name')).toHaveValue('Allowed while locked');
});
