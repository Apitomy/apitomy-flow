import { test, expect, field } from './test.ts';

test('real viewer renders positionless graph, repeated visits and live parallel history updates', async ({ page }) => {
    await page.goto('/?viewers');
    const viewer = page.getByTestId('viewer');
    await expect(viewer.locator('.react-flow__node')).toHaveCount(4);
    // Horizontal SVG paths have a zero-height bounding box; assert painted geometry and its HTML badge.
    const loop = viewer.getByRole('group', { name: 'Edge from h to a', exact: true }).locator('path').first();
    await expect.poll(async () => loop.evaluate(element => (element as SVGPathElement).getTotalLength())).toBeGreaterThan(0);
    await expect(viewer.getByText('context.retry', { exact: true })).toBeVisible();
    await expect(viewer.locator('.flow-node-current')).toHaveCount(2);
    await viewer.locator('.react-flow__node[data-id="a"]').click();
    await expect(viewer.locator('.workflow-viewer__context')).toContainText('second');
    await page.getByRole('button', { name: 'Update viewers' }).click();
    await expect(viewer.locator('.workflow-viewer__context')).toContainText('third');
    await expect(viewer.locator('.workflow-viewer__context')).toContainText('right');
    await viewer.getByRole('combobox', { name: 'Select visit' }).selectOption('0');
    await expect(viewer.locator('.workflow-viewer__context')).toContainText('left');
    await expect(viewer.locator('.workflow-viewer__context')).toContainText('first');
    await expect(viewer.locator('.flow-node-current')).toHaveCount(0);
    await expect(viewer.locator('.react-flow__node[data-id="a"]')).toContainText('Updated action');
    await viewer.getByRole('button', { name: 'Definition', exact: true }).click();
    await expect(viewer.locator('.workflow-viewer__context')).toContainText('{"nested":[1,null]}');
    await viewer.locator('.react-flow__pane').click({ position: { x: 10, y: 10 } });
    await expect(viewer.locator('.workflow-viewer__context')).toContainText('new context');
});

test('real diff updates positionless semantic classification and selected detail', async ({ page }) => {
    await page.goto('/?viewers');
    const diff = page.getByTestId('diff');
    await expect(diff.locator('.workflow-diff-viewer__summary')).toContainText('~0');
    await diff.locator('.react-flow__node[data-id="a"]').click();
    await page.getByRole('button', { name: 'Update viewers' }).click();
    await expect(diff.locator('.workflow-diff-viewer__summary')).toContainText('~1');
    await expect(diff.locator('.workflow-diff-viewer__detail')).toContainText('Updated action');
    await expect(diff.locator('.react-flow__node[data-id="a"]')).toHaveClass(/changed/);
    await page.getByRole('button', { name: 'Update viewers' }).click();
    await expect(diff.locator('.workflow-diff-viewer__summary')).toContainText('~0');
    await expect(diff.locator('.react-flow__node[data-id="a"]')).toHaveClass(/unchanged/);
});

test('independently installed packed ESM, declarations, peers and CSS render an interactive consumer', async ({ page }) => {
    await page.goto('http://127.0.0.1:4174');
    const editor = page.getByTestId('consumer-editor');
    await expect(editor.locator('.react-flow__node')).toHaveCount(2);
    await expect(editor.locator('.workflow-editor')).toHaveCSS('display', 'flex');
    await expect(editor.locator('.react-flow__node').first()).toHaveCSS('position', 'absolute');
    await editor.locator('.react-flow__node[data-id="s"]').click();
    await field(editor, 'Name').fill('Edited package');
    await expect(page.getByTestId('consumer-viewer').locator('.react-flow__node[data-id="s"]')).toContainText('Edited package');
    await expect(page.getByTestId('consumer-diff').locator('.workflow-diff-viewer__summary')).toContainText('~1');
    await editor.getByRole('button', { name: 'Undo', exact: true }).click();
    await expect(page.getByTestId('consumer-viewer').locator('.react-flow__node[data-id="s"]')).toContainText('Consumer start');
    await expect(page.getByTestId('consumer-diff').locator('.workflow-diff-viewer__summary')).toContainText('~0');
});
