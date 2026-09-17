import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Vite configuration for building the standalone public demo application.
 *
 * Unlike vite.config.ts (which builds @apitomy/flow-ui as a library with
 * React/PatternFly/xyflow externalized), this config builds src/dev/App.tsx
 * as a fully self-contained app, bundling all dependencies. Output goes to
 * dist-demo/ so it never collides with the library's dist/ output (which is
 * what `npm publish` ships).
 */
export default defineConfig({
  plugins: [react()],
  base: process.env.VITE_BASE_PATH || '/',
  build: {
    outDir: 'dist-demo',
  },
});
