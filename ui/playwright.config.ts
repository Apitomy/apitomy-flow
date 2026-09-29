import { defineConfig } from '@playwright/test';

export default defineConfig({
    testDir: './browser',
    testMatch: '**/*.spec.ts',
    fullyParallel: true,
    forbidOnly: !!process.env.CI,
    retries: 0,
    workers: process.env.CI ? 2 : 4,
    reporter: [['list'], ['html', { open: 'never' }]],
    use: {
        baseURL: 'http://127.0.0.1:4173',
        viewport: { width: 1500, height: 1000 },
        trace: 'retain-on-failure',
        screenshot: 'only-on-failure',
        launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
            ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {},
    },
    webServer: [
        { command: 'npx vite --config browser/vite.config.ts', url: 'http://127.0.0.1:4173', reuseExistingServer: false },
        { command: 'npm run preview --prefix browser/consumer', url: 'http://127.0.0.1:4174', reuseExistingServer: false },
    ],
});
