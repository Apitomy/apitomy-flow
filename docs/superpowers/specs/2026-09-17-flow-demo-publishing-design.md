# Flow Demo Publishing — Design

## Goal

Publish a live, browsable demo of `@apitomy/flow-ui` (the `WorkflowEditor`, `WorkflowDiffViewer`,
and `WorkflowViewer` components) to `apitomy.io/flow/demo/`, so visitors can try the components
without integrating Flow into their own application first. The published demo must always reflect
the most recently released version of `apitomy-flow`, and must be rebuilt and republished
automatically whenever a new release is created.

## Background

- `apitomy-flow` is the source repo (this repo). The `ui/` directory contains the
  `@apitomy/flow-ui` npm package (`WorkflowEditor`, `WorkflowDiffViewer`, `WorkflowViewer`).
- `ui/src/dev/App.tsx` is an existing internal dev harness (`npm run dev`) that already exercises
  all three components against realistic sample workflow data, with a PatternFly masthead/nav
  shell. It already carries the brand text "Apitomy Flow Demo" in its masthead.
- `apitomy.github.io` is the Jekyll-based static site published to `apitomy.io` (GitHub Pages,
  custom domain via `CNAME`).
- A directly analogous pattern already exists for a sibling project, `apitomy-openapi-editor`:
  - It has a standalone `test-app/` (a small Vite+React app that imports the library's `src/`
    directly, not through the built npm package).
  - `.github/workflows/publish-demo.yml` builds `test-app` with `VITE_BASE_PATH=/openapi-editor/demo/`
    and pushes the built output into `apitomy.github.io` at `openapi-editor/demo/`, committing with
    message `"Update OpenAPI Editor demo application (automated)"`.
  - However, that workflow triggers on `push: branches: [main]` (paths-filtered), **not** on
    release — it always reflects the tip of `main`, not a specific released version.
- `apitomy-flow` already has a separate `update-website.yaml` workflow, triggered on
  `release: [released]`, that checks out `apitomy.github.io`, updates release-metadata JSON files,
  and pushes — this is the pattern to follow for release-gating (not the openapi-editor
  push-to-main pattern).
- `apitomy-flow`'s `release.yaml` performs version bumping, tagging (`vX.Y.Z`), building, and
  `gh release create`; `npm-publish.yaml` (triggered on `release: [created]`) publishes
  `@apitomy/flow-ui` to npm from the release tag.

## Decisions (confirmed with stakeholder)

1. **Demo app source:** Reuse `ui/src/dev/App.tsx` as-is (no new dedicated demo app). It already
   covers all three components with realistic sample data.
2. **Build source:** Build from the released **source**, checked out at the release git tag —
   not from the published npm package. This matches the openapi-editor `test-app` approach
   (importing library source directly) and avoids any npm-propagation timing dependency.
3. **Demo location:** `apitomy.io/flow/demo/` (path `flow/demo/` in `apitomy.github.io`, mirroring
   `openapi-editor/demo/`). Add a "Live Demo" link to the Flow project page
   (`_pages/projects/flow.html`).
4. **Trigger:** A new, separate GitHub Actions workflow in `apitomy-flow`,
   `.github/workflows/publish-demo.yaml`, triggered on `release: [released]` — decoupled from
   `release.yaml`, independently re-runnable, consistent with the existing `update-website.yaml`
   pattern in this repo.
5. **Base path handling:** `ui/vite.config.ts` gains `base: process.env.VITE_BASE_PATH || '/'`
   (mirrors openapi-editor's `test-app/vite.config.ts`). Defaults to `/` for local dev; CI sets
   `VITE_BASE_PATH=/flow/demo/` for the demo build.
6. **Branding:** Small public-facing tweaks only — update `ui/index.html` `<title>` to
   "Apitomy Flow — Live Demo", and add a small link/banner in the dev app back to
   `https://apitomy.io/projects/flow/` (and/or the GitHub repo) so visitors can navigate back to
   docs. No deeper rework of the dev app's UI/content.
7. **Notifications:** No Slack notifications for the new workflow (unlike other apitomy-flow
   workflows, which do send Slack notifications).

## Non-goals

- No changes to `release.yaml`, `npm-publish.yaml`, or `update-website.yaml`.
- No new demo-specific sample data or scenarios — reuse what `ui/src/dev/App.tsx` already has.
- No changes to how `@apitomy/flow-ui` is packaged/published to npm.
- Not addressing the pre-existing gap where the OpenAPI Editor project page has no demo link yet
  (out of scope for this work, could be a quick follow-up but not part of this spec).

## Design

### 1. `ui/vite.config.ts` — base path support

Add:

```ts
base: process.env.VITE_BASE_PATH || '/',
```

This is a no-op change for the existing library build (`vite build` with the `lib` config) and for
local `npm run dev`, since the env var will be unset in those contexts. It only takes effect when
explicitly set by the demo-build CI step.

### 2. Separate demo build target

The existing `npm run build` script (`vite build && tsc -p tsconfig.lib.json`) builds the
**library** (`dist/index.js`, `dist/index.d.ts`, `dist/style.css`) using the `build.lib` config in
`vite.config.ts` — entry `src/index.ts`, with React/PatternFly/xyflow externalized. This is not
suitable for producing a standalone demo app (externals wouldn't be bundled; output isn't an
`index.html`-based app).

We need a distinct Vite build mode that:
- Uses `index.html` → `src/dev/App.tsx` as the entry point (an **app** build, not a **library**
  build).
- Bundles all dependencies (does not externalize React/PatternFly/xyflow).
- Outputs to a separate directory so it never collides with the library's `dist/` (which is what
  `npm publish` ships and what `files: ["dist"]` in `package.json` references).

Approach: add a second Vite config file, `ui/vite.demo.config.ts`, used only for the demo build:

```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: process.env.VITE_BASE_PATH || '/',
  build: {
    outDir: 'dist-demo',
  },
});
```

Add an npm script in `ui/package.json`:

```json
"build:demo": "vite build --config vite.demo.config.ts"
```

`index.html`'s existing script tag (`/src/dev/App.tsx`) becomes the entry point Vite discovers
automatically — no changes needed there beyond the `<title>` tweak. `tsc -p tsconfig.lib.json` is
NOT run for the demo build (that step only emits library type declarations, irrelevant to an app
bundle).

### 3. `ui/index.html` — title tweak

```html
<title>Apitomy Flow — Live Demo</title>
```

(Applies to local dev too; harmless.)

### 4. `ui/src/dev/App.tsx` — small banner/link addition

Add a small, unobtrusive link in the masthead content (next to or below the existing
"Apitomy Flow Demo" brand text) pointing to `https://apitomy.io/projects/flow/`, e.g. an
`ExternalLinkAltIcon`-accompanied link with text like "apitomy.io" or "Docs & GitHub". Exact
placement/copy left to implementation, kept minimal — this is a demo app, not a marketing page.

### 5. New workflow: `.github/workflows/publish-demo.yaml`

Triggered on `release: [released]` (same event as `update-website.yaml`), with an optional
`workflow_dispatch` for manual re-runs/dry-runs. Steps:

1. Guard: `if: github.repository_owner == 'Apitomy'`.
2. Checkout `apitomy-flow` at the release tag. The release event payload provides
   `github.event.release.tag_name` (e.g. `v2.0.3`); use it as the checkout `ref`. For
   `workflow_dispatch` runs, default to fetching `https://api.github.com/repos/Apitomy/apitomy-flow/releases/latest`
   to resolve the tag (mirrors the `Fetch required Details` step in `update-website.yaml`).
3. Set up Node.js (same version as other workflows, `24.21.0`).
4. `npm ci` in `ui/`.
5. `npm run build:demo` in `ui/`, with env `VITE_BASE_PATH=/flow/demo/`.
6. Checkout `apitomy.github.io` into a `website/` subdirectory, using `secrets.ACCESS_TOKEN` (same
   pattern as `update-website.yaml` / openapi-editor's `publish-demo.yml`).
7. Replace `website/flow/demo/` with the freshly built `ui/dist-demo/` contents:
   ```bash
   rm -rf website/flow/demo
   mkdir -p website/flow
   cp -r ui/dist-demo website/flow/demo
   ```
8. Commit and push, guarded on there being actual changes:
   ```bash
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
9. No Slack notification steps.

### 6. `apitomy.github.io` changes

- New directory `flow/demo/` — populated only by the CI workflow above. No placeholder needed:
  the workflow's `mkdir -p website/flow` step creates the parent directory itself before copying
  in the built output, so nothing needs to be pre-committed by hand.
- `_pages/projects/flow.html`: add a "Live Demo" link in the existing Links section:
  ```html
  <a href="/flow/demo/" class="project-link">Live Demo</a>
  ```

## Risks / Trade-offs

- **Timing gap:** Because `publish-demo.yaml` is a separate workflow from `release.yaml`, there's a
  window after a GitHub release is published where the demo hasn't been rebuilt yet. This mirrors
  the existing `update-website.yaml` behavior (release metadata also lags slightly behind release
  creation) — an accepted, pre-existing pattern in this repo, not a new risk class. The gap is on
  the order of a CI run (a few minutes), not blocking for any existing workflow.
- **Duplicate build config:** Introducing `vite.demo.config.ts` alongside the library's
  `vite.config.ts` adds a small amount of config duplication (plugins, base path logic). Kept
  deliberately minimal (no aliasing/resolve complexity like openapi-editor's `test-app` needs,
  since the demo app lives inside `ui/` and shares `node_modules` directly — no cross-package
  React duplication risk).
- **Two checkouts required by the tag-based build:** the workflow must resolve the tag name
  correctly for both `release` events and manual `workflow_dispatch` runs — mirrors existing
  logic in `update-website.yaml`, low risk.

## Testing

- Locally verify `npm run build:demo` produces a working `dist-demo/` when serving with a base
  path (e.g., `npx serve -s dist-demo` or similar, adjusting for the `/flow/demo/` base by testing
  via a reverse-proxy path, or simply confirming asset URLs in the emitted `index.html` are
  correctly prefixed when `VITE_BASE_PATH=/flow/demo/` is set).
- Confirm existing `npm run lint`, `npm test`, and the existing `npm run build` (library build)
  are unaffected by the new `vite.demo.config.ts` / `package.json` script additions.
- Dry-run the new workflow via `workflow_dispatch` (against the latest existing release) before
  relying on the `release: [released]` trigger, to validate the full checkout → build → cross-repo
  push flow end-to-end.
