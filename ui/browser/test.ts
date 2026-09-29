import { test as base, expect, type Locator } from '@playwright/test';
import type { Workflow } from '../src/index.ts';

/** Fail every scenario on browser exceptions and React lifecycle/console errors. */
export const test = base.extend<{ browserErrors: string[] }>({
    browserErrors: [async ({ page }, use) => {
        const errors: string[] = [];
        page.on('pageerror', error => errors.push(error.message));
        page.on('console', message => {
            if (message.type() === 'error'
                || (message.type() === 'warning' && /React|render|update depth/i.test(message.text().split('\n')[0]))) {
                errors.push(message.text());
            }
        });
        await use(errors);
        expect(errors).toEqual([]);
    }, { auto: true }],
});
export { expect };

/** Waits for a scheduled viewport change to start and then stop moving before pointer input. */
export async function waitForViewportChange(viewport: Locator, before: string | null): Promise<void> {
    // A stable pre-animation viewport is not ready: first observe the scheduled fit starting.
    await expect(viewport).not.toHaveAttribute('style', before ?? '');
    let previous: string | null = null;
    let unchangedSince = Date.now();
    await expect.poll(async () => {
        const current = await viewport.getAttribute('style');
        if (current !== previous) {
            previous = current;
            unchangedSince = Date.now();
        }
        // Require a quiet window, resetting it on every change rather than sleeping for fitView's duration.
        return Date.now() - unchangedSince >= 100;
    }, { message: 'import viewport has stopped moving', intervals: [50] }).toBe(true);
}

/** Reads host-observed public onChange payloads, never internal React/reducer state. */
export async function changes(editor: Locator): Promise<Workflow[]> {
    return JSON.parse(await editor.getByTestId('changes').textContent() ?? '[]');
}

/** Finds a property control by its visible adjacent label (legacy forms lack label associations). */
export function field(editor: Locator, label: string): Locator {
    return editor.locator('.properties-panel__field').filter({
        has: editor.page().locator('label').filter({ hasText: new RegExp(`^${label}$`) }),
    }).locator('input, textarea').first();
}

/** Waits for the real ReactFlow node measurement and initial viewport fit. */
export async function ready(editor: Locator): Promise<void> {
    await expect(editor.locator('.react-flow__node')).toHaveCount(4);
    await expect(editor.locator('.react-flow__node[data-id="a"]')).toBeVisible();
    await expect(editor.locator('.react-flow__edge')).toHaveCount(3);
}

/** Asserts each notification is atomic, with unique node IDs and no dangling endpoints. */
export function completeGraphs(documents: Workflow[]): void {
    for (const document of documents) {
        const ids = new Set(document.nodes.map(node => node.id));
        expect(ids.size).toBe(document.nodes.length);
        for (const edge of document.edges) {
            expect(ids.has(edge.source), `missing source ${edge.source}`).toBe(true);
            expect(ids.has(edge.target), `missing target ${edge.target}`).toBe(true);
        }
    }
}
