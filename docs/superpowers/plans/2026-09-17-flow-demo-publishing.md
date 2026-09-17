# Flow Demo Publishing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish a live, auto-updating demo of `@apitomy/flow-ui` (WorkflowEditor, WorkflowDiffViewer, WorkflowViewer) to `apitomy.io/flow/demo/`, rebuilt from the exact source of each `apitomy-flow` GitHub release.

**Architecture:** Reuse the existing `ui/src/dev/App.tsx` internal dev harness as the demo app. Add a second, app-mode Vite build config (`vite.demo.config.ts`) that bundles the dev app (rather than building the `@apitomy/flow-ui` library). A new GitHub Actions workflow in `apitomy-flow`, triggered on `release: [released]`, checks out the release tag, builds the demo with `VITE_BASE_PATH=/flow/demo/`, then checks out `apitomy.github.io` and pushes the built output to `flow/demo/`. A one-line link is added to the Flow project page on the website.

**Tech Stack:** Vite 8, React 19, TypeScript, GitHub Actions, Jekyll (apitomy.github.io, unaffected by this change beyond one HTML edit).

**Spec:** `docs/superpowers/specs/2026-09-17-flow-demo-publishing-design.md`

## Global Constraints

- Demo app source is `ui/src/dev/App.tsx` as-is — no new dedicated demo app (spec decision 1).
- Demo is built from the released **source**, checked out at the release git tag — never from the published npm package (spec decision 2).
- Demo is published at `apitomy.io/flow/demo/`, i.e. path `flow/demo/` in `apitomy.github.io` (spec decision 3).
- Publish workflow triggers on `release: [released]`, as a separate workflow file, not folded into `release.yaml` (spec decision 4).
- `ui/vite.config.ts` (library build) must remain otherwise unaffected — the base-path env var is a no-op when unset (spec decision 5).
- No Slack notifications in the new workflow (spec decision 7).
- Pin new GitHub Actions to the same SHAs already used elsewhere in this repo: `actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7`, `actions/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7`.
- Cross-repo push pattern must match the existing `publish-docs.yml` / `update-website.yaml` convention exactly: checkout `apitomy.github.io` into a `website/` subdir using `secrets.ACCESS_TOKEN`, `git config user.name "apitomy-ci"` / `user.email "apitomy.ci@gmail.com"`, `git diff --staged --quiet` guard before commit/push.

---

### Task 1: Add base-path support to the library Vite config

**Files:**
- Modify: `ui/vite.config.ts`
- Test: manual verification (no automated test framework covers Vite config; verified via existing `npm run build` and `npm test`)

**Interfaces:**
- Consumes: nothing new.
- Produces: `vite.config.ts` now honors `process.env.VITE_BASE_PATH`, falling back to `'/'`. This is a no-op today (unset in all current CI jobs) — it exists so Task 2/3 can later be verified not to have broken the library build, and matches the openapi-editor precedent referenced in the spec.

- [ ] **Step 1: Edit `ui/vite.config.ts` to add the `base` option**

Current content:
```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig({
  plugins: [react()],
  build: {
    lib: {
      entry: resolve(__dirname, 'src/index.ts'),
      formats: ['es'],
      fileName: 'index',
      cssFileName: 'style',
    },
    rollupOptions: {
      external: ['react', 'react-dom', 'react/jsx-runtime',
        '@xyflow/react', '@patternfly/react-core', '@patternfly/react-icons',
        '@patternfly/patternfly'],
    },
  },
});
```

New content:
```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig({
  plugins: [react()],
  base: process.env.VITE_BASE_PATH || '/',
  build: {
    lib: {
      entry: resolve(__dirname, 'src/index.ts'),
      formats: ['es'],
      fileName: 'index',
      cssFileName: 'style',
    },
    rollupOptions: {
      external: ['react', 'react-dom', 'react/jsx-runtime',
        '@xyflow/react', '@patternfly/react-core', '@patternfly/react-icons',
        '@patternfly/patternfly'],
    },
  },
});
```

- [ ] **Step 2: Run the existing library build to confirm no regression**

Run (from `ui/`): `npm run build`
Expected: succeeds exactly as before (produces `dist/index.js`, `dist/index.d.ts`, `dist/style.css`), no new warnings related to `base`.

- [ ] **Step 3: Run the existing test suite to confirm no regression**

Run (from `ui/`): `npm test`
Expected: PASS — same 283 tests passing as the pre-change baseline.

- [ ] **Step 4: Commit**

```bash
git add ui/vite.config.ts
git commit -m "Add VITE_BASE_PATH env override to library Vite config"
```

---

### Task 2: Add a standalone demo (app-mode) Vite build

**Files:**
- Create: `ui/vite.demo.config.ts`
- Modify: `ui/package.json` (add `build:demo` script)
- Modify: `ui/index.html` (title tweak)
- Test: manual verification of build output (no unit-test framework covers build tooling)

**Interfaces:**
- Consumes: `ui/src/dev/App.tsx` and `ui/index.html` as the existing app entry point (unchanged import graph).
- Produces: `npm run build:demo` (run from `ui/`) emits a standalone, fully-bundled app into `ui/dist-demo/`, honoring `VITE_BASE_PATH` for the `base` option. This output directory is what Task 4's workflow will copy into the website repo.

- [ ] **Step 1: Create `ui/vite.demo.config.ts`**

```ts
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
```

- [ ] **Step 2: Update the demo page title in `ui/index.html`**

Change:
```html
  <title>Apitomy Flow — Dev</title>
```
to:
```html
  <title>Apitomy Flow — Live Demo</title>
```

- [ ] **Step 3: Add the `build:demo` script to `ui/package.json`**

In the `"scripts"` block, add (after `"build"`):
```json
    "build:demo": "vite build --config vite.demo.config.ts",
```

Resulting scripts block:
```json
  "scripts": {
    "dev": "vite",
    "build": "vite build && tsc -p tsconfig.lib.json",
    "build:demo": "vite build --config vite.demo.config.ts",
    "preview": "vite preview",
    "lint": "eslint src/",
    "test": "vitest run",
    "test:watch": "vitest"
  },
```

- [ ] **Step 4: Run the demo build**

Run (from `ui/`): `npm run build:demo`
Expected: succeeds, creates `ui/dist-demo/index.html` plus a bundled `assets/` directory. Confirm no externalized-dependency errors (React/PatternFly/xyflow must be bundled, not left as bare imports) by checking the build output does not warn about unresolved externals.

- [ ] **Step 5: Verify base-path prefixing works**

Run (from `ui/`): `VITE_BASE_PATH=/flow/demo/ npm run build:demo`
Then inspect: `grep -o 'src="[^"]*"\|href="[^"]*"' dist-demo/index.html`
Expected: asset URLs are prefixed with `/flow/demo/` (e.g. `src="/flow/demo/assets/index-XXXX.js"`).

- [ ] **Step 6: Verify the unprefixed build still works (default base path)**

Run (from `ui/`): `rm -rf dist-demo && npm run build:demo`
Then inspect: `grep -o 'src="[^"]*"\|href="[^"]*"' dist-demo/index.html`
Expected: asset URLs are rooted at `/` (e.g. `src="/assets/index-XXXX.js"`), confirming the env var default (`'/'`) works when unset.

- [ ] **Step 7: Confirm the library build and lint/test are still unaffected**

Run (from `ui/`): `npm run lint && npm test && npm run build`
Expected: all pass, identical to Task 1's baseline (283 tests, clean lint, library `dist/` unchanged in structure).

- [ ] **Step 8: Add `dist-demo/` to `.gitignore`**

Check `ui/.gitignore` (or repo-root `.gitignore`) for an existing `dist` ignore entry; add a `dist-demo` entry alongside it so the local build artifact is never accidentally committed in `apitomy-flow`.

- [ ] **Step 9: Commit**

```bash
git add ui/vite.demo.config.ts ui/index.html ui/package.json .gitignore
git commit -m "Add standalone demo build target (vite.demo.config.ts)"
```

---

### Task 3: Add a public-facing banner link to the dev/demo app

**Files:**
- Modify: `ui/src/dev/App.tsx`

**Interfaces:**
- Consumes: existing `MastheadBrand`, `MastheadContent`, `ExternalLinkAltIcon` imports already present in `App.tsx` (see lines 6–25 for the existing import block).
- Produces: no new exported interfaces — this is a visual-only addition inside the existing masthead JSX.

- [ ] **Step 1: Locate the existing masthead markup**

Read `ui/src/dev/App.tsx` around line 256 (the `<MastheadBrand>Apitomy Flow Demo</MastheadBrand>` line) to see the surrounding `<Masthead>` / `<MastheadMain>` / `<MastheadContent>` structure before editing.

- [ ] **Step 2: Add a link back to the Flow project page next to the brand text**

Locate:
```tsx
        <MastheadBrand>Apitomy Flow Demo</MastheadBrand>
```

Replace with (adjust indentation to match surrounding JSX exactly once the file is read):
```tsx
        <MastheadBrand>
          Apitomy Flow Demo
          <a
            href="https://apitomy.io/projects/flow/"
            target="_blank"
            rel="noreferrer"
            style={{ marginLeft: '1rem', fontSize: '0.75rem', fontWeight: 'normal' }}
          >
            apitomy.io <ExternalLinkAltIcon />
          </a>
        </MastheadBrand>
```

`ExternalLinkAltIcon` is already imported in this file (see the existing import list) — confirm it's imported before assuming it's available; if not already imported, add it to the existing `@patternfly/react-icons` import line.

- [ ] **Step 3: Rebuild the demo and visually confirm**

Run (from `ui/`): `npm run build:demo`
Then: `npx vite preview --config vite.demo.config.ts --outDir dist-demo` (or simply open `dist-demo/index.html` via a local static server) and confirm the "apitomy.io" link renders in the masthead and is clickable.

- [ ] **Step 4: Run lint and tests to confirm no regressions**

Run (from `ui/`): `npm run lint && npm test`
Expected: PASS, no new lint errors, all existing tests still passing (this file has no direct unit tests, but confirm no import/type errors surface via lint).

- [ ] **Step 5: Commit**

```bash
git add ui/src/dev/App.tsx
git commit -m "Add link back to apitomy.io in demo app masthead"
```

---

### Task 4: Add the `publish-demo.yaml` GitHub Actions workflow

**Files:**
- Create: `.github/workflows/publish-demo.yaml`

**Interfaces:**
- Consumes: `npm run build:demo` (Task 2) producing `ui/dist-demo/`; `secrets.ACCESS_TOKEN` (already configured in this repo, used identically by `publish-docs.yml` and `update-website.yaml`).
- Produces: on every `release: [released]` event (and on manual `workflow_dispatch`), pushes the freshly built demo to `flow/demo/` in `Apitomy/apitomy.github.io`.

- [ ] **Step 1: Create `.github/workflows/publish-demo.yaml`**

```yaml
name: Publish Demo Application

on:
  release:
    types: [released]
  workflow_dispatch: {}

jobs:
  publish-demo:
    runs-on: ubuntu-latest
    if: github.repository_owner == 'Apitomy'

    steps:
      - name: Resolve release tag
        id: release
        run: |
          if [ -n "${{ github.event.release.tag_name }}" ]; then
            TAG="${{ github.event.release.tag_name }}"
          else
            TAG=$(curl -sf https://api.github.com/repos/Apitomy/apitomy-flow/releases/latest | jq -r '.tag_name')
          fi
          if [ -z "$TAG" ] || [ "$TAG" = "null" ]; then
            echo "ERROR: Failed to resolve release tag"
            exit 1
          fi
          echo "tag=$TAG" >> "$GITHUB_OUTPUT"

      - name: Checkout apitomy-flow at release tag
        uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7
        with:
          ref: ${{ steps.release.outputs.tag }}

      - name: Setup Node.js
        uses: actions/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7
        with:
          node-version: 24.21.0
          cache: npm
          cache-dependency-path: ui/package-lock.json

      - name: Install dependencies
        run: npm ci
        working-directory: ui

      - name: Build demo application
        run: npm run build:demo
        working-directory: ui
        env:
          VITE_BASE_PATH: /flow/demo/

      - name: Checkout website repository
        uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7
        with:
          repository: Apitomy/apitomy.github.io
          token: ${{ secrets.ACCESS_TOKEN }}
          path: website

      - name: Copy built demo to website
        run: |
          rm -rf website/flow/demo
          mkdir -p website/flow
          cp -r ui/dist-demo website/flow/demo

      - name: Commit and push to website
        run: |
          cd website
          git config user.name "apitomy-ci"
          git config user.email "apitomy.ci@gmail.com"
          git add flow/demo
          if git diff --staged --quiet; then
            echo "No changes to commit"
          else
            git commit -m "Update Flow demo application (automated)"
            git push
          fi
```

- [ ] **Step 2: Validate YAML syntax**

Run: `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/publish-demo.yaml'))"`
Expected: no output (no parse errors). If `pyyaml` isn't available, alternatively run: `npx -y js-yaml .github/workflows/publish-demo.yaml > /dev/null` and confirm exit code 0.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/publish-demo.yaml
git commit -m "Add publish-demo workflow to publish Flow demo on release"
```

---

### Task 5: Dry-run the new workflow via `workflow_dispatch`

**Files:** none (operational validation task)

**Interfaces:**
- Consumes: the `publish-demo.yaml` workflow from Task 4, already pushed to a branch on GitHub.
- Produces: a live-verified confirmation that the full checkout → build → cross-repo push flow works end-to-end, before relying on the `release: [released]` trigger for real releases.

- [ ] **Step 1: Push the working branch**

```bash
git push origin feature/flow-demo-publishing
```

- [ ] **Step 2: Trigger the workflow manually via GitHub CLI**

Run:
```bash
gh workflow run publish-demo.yaml --ref feature/flow-demo-publishing
```

- [ ] **Step 3: Watch the run and confirm success**

Run:
```bash
gh run watch $(gh run list --workflow=publish-demo.yaml --limit 1 --json databaseId --jq '.[0].databaseId')
```
Expected: all steps succeed, including the final "Commit and push to website" step (it should either push a new commit to `apitomy.github.io` or report "No changes to commit" if content is identical to a prior run).

- [ ] **Step 4: Verify the pushed content in `apitomy.github.io`**

Run:
```bash
cd /home/ewittman/git/apitomy/apitomy.github.io/.worktrees/flow-demo-publishing
git fetch origin main
git log origin/main -3 --oneline -- flow/demo
```
Expected: a recent commit "Update Flow demo application (automated)" touching `flow/demo/`, authored by `apitomy-ci`.

- [ ] **Step 5: No commit for this task** (operational verification only; nothing to commit in `apitomy-flow`).

---

### Task 6: Add a "Live Demo" link to the Flow project page

**Files:**
- Modify: `/home/ewittman/git/apitomy/apitomy.github.io/.worktrees/flow-demo-publishing/_pages/projects/flow.html`

**Interfaces:**
- Consumes: `flow/demo/` now exists at the site root (populated by Task 5's dry run, and by every future release going forward).
- Produces: a visible "Live Demo" link on `apitomy.io/projects/flow/`.

- [ ] **Step 1: Edit the Links section of `_pages/projects/flow.html`**

Locate:
```html
<div class="project-section">
    <h2>Links</h2>
    <div class="project-links-section">
        <a href="/projects/flow/docs/" class="project-link">Documentation</a>
        <a href="https://github.com/Apitomy/apitomy-flow" class="project-link">
            GitHub Repository
        </a>
        <a href="https://github.com/Apitomy/apitomy-flow/releases"
           class="project-link">Releases</a>
    </div>
</div>
```

Replace with:
```html
<div class="project-section">
    <h2>Links</h2>
    <div class="project-links-section">
        <a href="/flow/demo/" class="project-link">Live Demo</a>
        <a href="/projects/flow/docs/" class="project-link">Documentation</a>
        <a href="https://github.com/Apitomy/apitomy-flow" class="project-link">
            GitHub Repository
        </a>
        <a href="https://github.com/Apitomy/apitomy-flow/releases"
           class="project-link">Releases</a>
    </div>
</div>
```

- [ ] **Step 2: Verify the site builds locally (if Jekyll toolchain is available)**

Run (from the `apitomy.github.io` worktree root): `bundle exec jekyll build 2>&1 | tail -30`
Expected: build succeeds with no new errors. If the Jekyll/Ruby toolchain isn't installed in this environment, skip this step and instead visually inspect the HTML diff for correctness (valid markup, matching indentation/style of surrounding links).

- [ ] **Step 3: Commit**

```bash
cd /home/ewittman/git/apitomy/apitomy.github.io/.worktrees/flow-demo-publishing
git add _pages/projects/flow.html
git commit -m "Add Live Demo link to Flow project page"
```

- [ ] **Step 4: Push the branch**

```bash
git push origin feature/flow-demo-publishing
```

---

## Post-Plan Follow-Up (not part of this plan's tasks)

- Open a PR from `feature/flow-demo-publishing` to `main` in `apitomy-flow` (includes Tasks 1–4's commits).
- Open a PR from `feature/flow-demo-publishing` to `main` in `apitomy.github.io` (includes Task 6's commit, plus the earlier `.gitignore` commit for `.worktrees/`).
- After both PRs merge, confirm the next real `apitomy-flow` release triggers `publish-demo.yaml` automatically via the `release: [released]` event (no manual dispatch needed going forward).
