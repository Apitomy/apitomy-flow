import { test, expect, ready } from './test.ts';

const node = (editor: import('@playwright/test').Locator, id: string) => editor.locator(`.react-flow__node[data-id="${id}"]`);

test('a staged proposal previews, accepts as one undo step and stays highlighted', async ({ page }) => {
    await page.goto('/?ai');
    const editor = page.getByTestId('one');
    await ready(editor);
    await editor.getByRole('button', { name: 'Propose change' }).click();
    const bar = editor.getByRole('region', { name: 'Proposed changes' });
    await expect(bar).toContainText('Add a wait before End');
    await expect(bar).toContainText('+1 node');
    await expect(node(editor, 'w')).toHaveClass(/flow-proposal--added/);
    await node(editor, 'w').click();
    await expect(bar.getByRole('group', { name: 'Proposed change to w' })).toContainText('PT1M');
    await bar.getByRole('button', { name: 'Accept' }).click();
    await expect(bar).toBeHidden();
    await expect(node(editor, 'w')).toHaveClass(/flow-applied/);
    await expect(editor.getByTestId('proposal-resolutions')).toHaveText('["cs-1:accepted"]');
    await editor.getByRole('button', { name: 'Undo', exact: true }).click();
    await expect(node(editor, 'w')).toHaveCount(0);
});

test('a user edit makes a staged proposal stale and it can only be dismissed', async ({ page }) => {
    await page.goto('/?ai');
    const editor = page.getByTestId('one');
    await ready(editor);
    await editor.getByRole('button', { name: 'Propose change' }).click();
    await node(editor, 'a').click();
    await page.keyboard.press('Delete');
    const bar = editor.getByRole('region', { name: 'Proposed changes' });
    await expect(bar).toContainText('Out of date');
    await expect(bar.getByRole('button', { name: 'Accept' })).toHaveCount(0);
    await expect(editor.getByTestId('proposal-resolutions')).toHaveText('["cs-1:stale"]');
    await bar.getByRole('button', { name: 'Dismiss' }).click();
    await expect(bar).toBeHidden();
});

test('rejecting removes the ghosts and stale change sets are refused with a code', async ({ page }) => {
    await page.goto('/?ai');
    const editor = page.getByTestId('one');
    await ready(editor);
    await editor.getByRole('button', { name: 'Propose stale change' }).click();
    await expect(editor.getByTestId('handle-results')).toContainText('\\"code\\":\\"stale\\"');
    await editor.getByRole('button', { name: 'Propose change' }).click();
    await editor.getByRole('region', { name: 'Proposed changes' }).getByRole('button', { name: 'Reject' }).click();
    await expect(node(editor, 'w')).toHaveCount(0);
    await expect(editor.getByTestId('proposal-resolutions')).toHaveText('["cs-1:rejected"]');
});

test('an applied change set is highlighted until the user edits content', async ({ page }) => {
    await page.goto('/?ai');
    const editor = page.getByTestId('one');
    await ready(editor);
    await editor.getByRole('button', { name: 'Apply change' }).click();
    await expect(node(editor, 'w')).toHaveClass(/flow-applied/);
    await node(editor, 'a').click();
    await page.keyboard.press('Delete');
    await expect(node(editor, 'w')).not.toHaveClass(/flow-applied/);
});
