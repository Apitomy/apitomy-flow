import { test, expect, ready, field } from './test.ts';

test('async action provider replacement ignores stale responses and renders the current descriptors', async ({ page }) => {
    await page.goto('/?async');
    const editor = page.getByTestId('one');
    await ready(editor);
    await editor.locator('.react-flow__node[data-id="a"]').click();
    await expect(editor.getByRole('textbox', { name: 'Type to filter' })).toHaveAttribute('placeholder', 'Loading...');
    await editor.getByRole('button', { name: 'Replace provider', exact: true }).click();
    await editor.getByRole('button', { name: 'Resolve current actions', exact: true }).click();
    await expect(editor.getByText('Current provider description')).toBeVisible();
    await editor.getByRole('button', { name: 'Resolve stale actions', exact: true }).click();
    await expect(editor.getByText('Current provider description')).toBeVisible();
    await expect(editor.getByText('Stale provider description')).toHaveCount(0);
    await editor.getByRole('button', { name: 'Menu toggle' }).click();
    // PatternFly portals its listbox outside the editor root and includes description in the name.
    await expect(page.getByRole('option', { name: /^Current action/ })).toBeVisible();
    await expect(page.getByRole('option', { name: /^Stale action/ })).toHaveCount(0);
});

test('failed action loading falls back to editable free-form input', async ({ page }) => {
    await page.goto('/?async');
    const editor = page.getByTestId('one');
    await ready(editor);
    await editor.locator('.react-flow__node[data-id="a"]').click();
    await editor.getByRole('button', { name: 'Reject actions', exact: true }).click();
    await expect(field(editor, 'Action Type')).toHaveValue('noop');
    await field(editor, 'Action Type').fill('host.custom');
    await expect(field(editor, 'Action Type')).toHaveValue('host.custom');
    await expect(editor.getByPlaceholder('Label', { exact: true })).toHaveCount(4);
});

test('async host validation renders latest result, ignores stale responses and clears rejected host results', async ({ page }) => {
    await page.goto('/?async');
    const editor = page.getByTestId('one');
    await ready(editor);
    await editor.locator('.react-flow__node[data-id="a"]').click();
    // The host exposes pending request count, allowing the debounce to run without sleeps.
    await expect(editor.getByTestId('validation-count')).toHaveText('1');
    await field(editor, 'Name').fill('Changed');
    await expect(editor.getByTestId('validation-count')).toHaveText('2');
    await editor.getByRole('button', { name: 'Resolve validation', exact: true }).click();
    await expect(editor.locator('.properties-panel')).toContainText('Current host warning');
    await editor.getByRole('button', { name: 'Resolve stale validation', exact: true }).click();
    await expect(editor.locator('.properties-panel')).toContainText('Current host warning');
    await expect(editor.getByText('Stale host warning')).toHaveCount(0);
    await field(editor, 'Name').fill('Rejected');
    await expect(editor.getByTestId('validation-count')).toHaveText('3');
    await editor.getByRole('button', { name: 'Reject validation', exact: true }).click();
    await expect(editor.getByText('Current host warning')).toHaveCount(0);
    await expect(editor.getByText('MISSING_START_INPUTS')).toBeVisible();
});
