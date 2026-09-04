# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

TinySlicer is a **browser-only resin slicer** for the fixed "TinyMaker" printer profile. It imports one STL, lets the user place and rotate it, adds supports, previews the reconstructed print, and (per spec) exports a TinyMaker ZIP job. Everything — parsing, rendering, slicing, PNG/G-code generation — runs client-side with no backend and no network access after assets load. `docs/slicer-spec.md` is the authoritative product/format spec (§7.3 covers rafts); `docs/*research*.md` and `docs/support-density*.md` are the reasoning behind the support algorithms.

Implemented workflow steps: `prepare`, `supports`, and `preview`. `export` is specified but not built (`WorkspaceState.canNavigateTo` returns `false` for it). Note the built `preview` step is a **voxel-reconstruction solid mesh** of model + supports, not the spec §9 per-layer mask slider — that slider is still unbuilt.

## Commands

Package manager is **pnpm** (`engine-strict=true`, committed `pnpm-lock.yaml`). Scripts are also runnable as `pnpm <script>`.

- `pnpm dev` — Vite dev server
- `pnpm build` / `pnpm preview` — production build (adapter-auto) and preview
- `pnpm check` — `svelte-check` type checking (run this, not `tsc`); `pnpm check:watch` to watch
- `pnpm lint` — `prettier --check` + `eslint`
- `pnpm format` — `prettier --write`
- `pnpm test` — run the full Vitest suite once
- `pnpm test:unit` — Vitest in watch mode

`pnpm check`, `pnpm test`, `pnpm lint`, and `pnpm exec vitest` are pre-approved in `.claude/settings*.json`.

### Running a single test

Vitest is configured with two **projects** (`vite.config.ts`):

- `server` — Node environment, matches `src/**/*.{test,spec}.{js,ts}` **except** `*.svelte.{test,spec}.*`. Every current test runs here, including component smoke tests, which use `svelte/server`'s `render()` (SSR to string) rather than a DOM.
- `client` — real browser via `@vitest/browser-playwright` (chromium, headless), matches `src/**/*.svelte.{test,spec}.{js,ts}`. Configured but currently has **no** matching files; add browser/component tests as `*.svelte.spec.ts`.

Run one file: `pnpm exec vitest run src/lib/slicing/model-layer-masks.spec.ts`
Filter by name: `pnpm exec vitest run -t "rasterizes a cube"`
Restrict to a project: append `--project server` or `--project client`.

Browser tests require Playwright's chromium (`pnpm exec playwright install chromium`).

`test.expect.requireAssertions` is **on** — every test must make at least one assertion.

## Conventions

- **Svelte 5 runes mode is forced** for all non-`node_modules` files. Use `$state` / `$derived` / `$props` / `$effect`. Reactive logic outside components lives in `*.svelte.ts` modules (e.g. `workspace-state.svelte.ts`, `orbit-camera.svelte.ts`, `canvas-metrics.svelte.ts`).
- Prettier: tabs, single quotes, no trailing commas, width 100. ESLint disables `no-undef` (TS handles it).
- `$lib` → `src/lib`. Path aliases handled by SvelteKit, not tsconfig.
- **Tailwind v4** (`@tailwindcss/vite`), no `tailwind.config`. All design tokens — colours, font, breakpoints (`tablet`/`mobile`), shared `u-*` component classes — are declared in `src/routes/layout.css` (`@theme` block); components carry only Tailwind utilities. `prettier-plugin-tailwindcss` sorts classes against that stylesheet.
- When writing/editing Svelte code, the Svelte MCP server is available (see `AGENTS.md`): use `list-sections` + `get-documentation` for Svelte 5 / SvelteKit questions and run `svelte-autofixer` on Svelte code until it's clean.

## Architecture

The design principle (from the spec): **core geometry, slicing, and support logic are framework-independent TypeScript modules with co-located unit tests.** Svelte only provides the shell and imperative glue to Three.js. Keep new geometry/slicing logic in plain `.ts` with a `.spec.ts` beside it.

### The one printer constant source

`src/lib/printer/tinymaker.ts` — `TINYMAKER_PROFILE` (resolution 320×240, build volume 40.8×30.6×60 mm, layer height 0.05 mm). Everything derives build-volume and pixel-pitch math from here; never hard-code these numbers elsewhere.

Coordinate system: millimetres everywhere, `Z = 0` is the build plate, `+Z` into the printable volume. On import the model is centered on the plate, dropped so its lowest point sits at `Z = 0`, and given a starting Z-rotation that best fits the plate (`findInBoundsZRotation`).

### Central state: `src/lib/workspace/workspace-state.svelte.ts`

`WorkspaceState` is the reactive hub `src/routes/+page.svelte` instantiates once. It holds the model, translation, rotation quaternion, support points, and current `WorkflowStep` (`prepare | supports | preview | export`). Almost everything else is `$derived`:

- transformed bounds, out-of-bounds / support-margin checks;
- `interactionMode` — `transform-model` (prepare) / `place-supports` (supports) / `readonly` (preview, export);
- `raftPlan` = `generateRaftPlan(...)` over the plate-anchored support feet, and `supportPlan` = `generateSupportPlan(points, raftPlan.raftedSupportPointIds)` (rafted feet are dropped).

`requestStep('supports')` (or `'preview'`) kicks off auto-support generation on first entry via `autoSupportBuild` (a worker-backed `AutoSupportBuild`); its outcome callback seeds the editable `supportPoints`. Support placement is blocked and a progress bar shows while `autoSupportBuild.status === 'building'`. `requestStep('preview')` additionally requests `previewBuild` (a worker-backed `PreviewBuild`). Stepping back to `prepare` from `supports`/`preview` with placed supports opens the discard dialog. The constructor takes an optional `createAutoSupportWorker` factory so tests can inject a synchronous stub; `+page.svelte` disposes `autoSupportBuild` and `previewBuild` on unmount.

### Rendering: `src/lib/workspace/build-volume-renderer/`

`build-volume-renderer.ts` (parent file) is a **facade** that re-exports the subfolder and exposes canvas-keyed imperative functions. `BuildVolumeViewport` (one per `<canvas>`, tracked in a `WeakMap`, disposed on unmount) owns the Three.js `Scene`, camera, and sub-renderers:

- `BuildVolumeScene` (plate/grid/bounds/rulers/support-margin), `RenderedModel`, `SupportRenderer`, `RaftRenderer`, `SupportMarkerRenderer` (one raycastable flat disc per support point, tagged `userData.supportPointId`), `PreviewRenderer` (the baked voxel mesh), `TransformGizmo`;
- `ModelInteractionController` — raycast picking + drag gizmos; support picking helpers live in `support-picking.ts` (`pickSupportSurface`, `findModelSurfaceBelow` for model-to-model contacts).

Rendering is rAF-coalesced via `schedule(state)` taking a plain `BuildVolumeRenderState` (now also carries `raftIslands` and `previewMesh`). When `previewMesh !== null` the viewport hides the model, supports, rafts, and markers and shows only the preview mesh.

### Model transforms are non-destructive

Imported `positions` (a `Float32Array` of triangle triples) are never rewritten after the initial centering. Translation + a rotation **quaternion** (`ModelRotation` is `{x,y,z,w}`) are re-applied about the model's bounding-box center by every consumer independently: the renderer, the rasterizer, bounds math (`model-transform.ts`), and the support-risk preview. If you add a consumer of transformed geometry, reuse `model-transform.ts` helpers so the composed transform stays consistent.

### Slicing: `src/lib/slicing/model-layer-masks.ts`

`ModelLayerMaskRasterizer` scanline-rasterizes the transformed mesh once in its constructor, caching **sorted vertical (Z) ray crossings per pixel** (half-open edge rule; even-cluster merging so touching solids don't create spurious transitions). `createLayerMask(i)` / `masks()` then produce binary `BinaryLayerMask`s lazily (so callers can use a rolling window). Layers are the fixed 0.05 mm grid; image `i.png` (one-based) is the plane at `z = i * 0.05`. `verticalIntervalsAtPixel` exposes the cached spans for support contact math. `diagnostics.oddIntersectionPixelCount > 0` means a non-watertight mesh at the sampled pixels.

### Preview reconstruction: `src/lib/slicing/`

The Preview step reuses the slicing masks to rebuild the printed solid — the same coverage the PNG export will emit, so both share these modules:

- `layer-coverage.ts` — `LayerCoverageRasterizer` wraps `ModelLayerMaskRasterizer`, rasterizes at `PREVIEW_SUPERSAMPLE` (×4) the printer resolution and box-downsamples for the deterministic supersample/downsample anti-aliasing the spec §8.3 calls for. Returns a combined **model + support (+ raft)** `CoverageMask` in `[0,1]` per layer.
- `support-cross-sections.ts` — `supportPartCircleAtZ` / `supportPlanCirclesAtZ` intersect each support part with a horizontal plane into discs, so supports composite into the mask instead of a 3D boolean union.
- `preview-mesh.ts` — `buildPreviewMesh` thresholds each layer's coverage at `PREVIEW_ISO_LEVEL` (0.5), treats every passing pixel as one voxel, and greedy-meshes the exposed voxel faces into a single flat-shaded mesh (millimetres, `Z = 0` on the plate). Model and supports fuse in the coverage field, not via CSG.
- `preview-mesh-worker.ts` + `-types.ts` — run `buildPreviewMesh` off-thread, posting `progress` then `result`/`error`. `src/lib/workspace/preview-state.svelte.ts` (`PreviewBuild`) owns the worker lifecycle, signature dedup, reactive `status`/`progress`/`mesh`/`layerCount`/`watertight`, and caches the last ready mesh. Mirrors the `AutoSupportBuild` pair exactly.

### Supports

- `src/lib/workspace/supports.ts` — post geometry (flared **foot** → cylindrical **shaft** → **junction** → angled tapered **neck**/tip), all dimensions as exported `SUPPORT_*_MM` constants. `generateSupportPlan(points, raftedPointIds?)` turns `SupportPoint[]` into renderable `SupportStructure[]` plus `unresolvedPoints`; rafted points omit the foot (the raft slab replaces it). Handles model-to-model supports via `lowerContactPosition` (no foot on the plate). `SUPPORT_PLATE_EDGE_MARGIN_MM` defines the "supports won't fit" border drawn in the viewport.
- `src/lib/supports/detect-unsupported.ts` — framework-free layer-mask analysis: `dilateBinaryMask` + subtract (`U[i] = M[i] - dilate(M[i-k], allowance)`) to find unsupported pixels, connected-component labeling into `island` vs `overhang` regions, then `suggestCoverageContacts` greedily circle-covers each region using an interior distance transform.
- `src/lib/supports/generate-auto-supports.ts` — glues the rasterizer to the detector to produce a **conservative, deterministic first draft** of contact hits, reusing the exact same post geometry as manual placement. It is explicitly not a printability guarantee; it bails out entirely on non-watertight meshes. Takes an optional `onProgress(completedLayers, totalLayers)` callback (ticks every `AUTO_SUPPORT_PROGRESS_LAYER_STRIDE` scanned layers).
- `src/lib/supports/auto-support-worker.ts` + `auto-support-worker-types.ts` — run `generateAutoSupportHits` off the main thread; `src/lib/workspace/auto-support-state.svelte.ts` (`AutoSupportBuild`) owns the worker lifecycle, request-id/signature dedup, and reactive `status`/`progress`/`error`.
- **Rafts** (`src/lib/supports/raft-plan.ts`, `raft-geometry.ts`; spec §7.3 is authoritative). `generateRaftPlan` single-linkage-clusters plate-anchored support feet within `RAFT_BINDING_DISTANCE_MM`; clusters of ≥ `RAFT_MIN_ISLAND_SUPPORTS` become `RaftIsland`s — a convex-hull core slab plus a 45° removable rim ("dinner-plate brim" for a scraper). `raftedSupportPointIds` feeds `generateSupportPlan`; `raftCrossSectionAtZ` feeds `LayerCoverageRasterizer`; `raftMeshData` (framework-free closed mesh, ear-clipping triangulation) feeds `RaftRenderer`. Recomputed from scratch on every support-set change, like the support plan.
- `src/lib/workspace/support-risk.ts` — cheap mesh-normal overhang highlight for the viewport only; deliberately not a slice-island analysis.

### UI shell

`src/routes/+layout.svelte` just imports `layout.css` + the favicon. `src/routes/+page.svelte` is thin: instantiates `WorkspaceState`, handles STL import + window-wide file drag/drop, and lays out the components. `src/lib/workspace/*.svelte`:

- `WorkflowHeader` — step nav (`WORKFLOW_STEPS`) + file input.
- `WorkspaceViewport` — canvas + orbit camera + gizmo/support interaction + step-transition buttons, all wired through the renderer facade. `CanvasMetrics` (`canvas-metrics.svelte.ts`) tracks its size/DPR via `ResizeObserver`.
- `WorkspaceAside` — right-hand panel: scene info, per-step status (transform offsets / support count / preview layer count), and the fixed printer profile.
- `DiscardSupportsDialog` — confirm before discarding placed supports on step-back.
