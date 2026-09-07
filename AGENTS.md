# AGENTS.md

This file provides guidance to coding agents working with code in this repository.

## What this is

TinySlicer is a **browser-only resin slicer** for the fixed "TinyMaker" printer profile. It imports one STL, lets the user place and rotate it, adds supports, previews the reconstructed print, and exports a TinyMaker print-project folder (or an equivalent ZIP). Everything — parsing, rendering, slicing, PNG/G-code generation — runs client-side with no backend and no network access after assets load. `docs/slicer-spec.md` is the authoritative product/format spec (§7.3 covers rafts, §10 the export format); `docs/*research*.md` and `docs/support-density*.md` are the reasoning behind the support algorithms.

All four workflow steps (`prepare`, `supports`, `preview`, `export`) are implemented. Note the built `preview` step is a **voxel-reconstruction solid mesh** of model + supports, not the spec §9 per-layer mask slider — that slider is still unbuilt.

## Commands

Package manager is **pnpm** (`engine-strict=true`, committed `pnpm-lock.yaml`). Scripts are also runnable as `pnpm <script>`.

- `pnpm dev` — Vite dev server
- `pnpm build` / `pnpm preview` — production build (`@sveltejs/adapter-node`) and preview
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

- **Svelte 5 runes mode is forced** for all non-`node_modules` files. Use `$state` / `$derived` / `$props` / `$effect`. Reactive logic outside components lives in `*.svelte.ts` modules (e.g. `scene-state.svelte.ts`, `supports-state.svelte.ts`, `workflow-state.svelte.ts`, `export-state.svelte.ts`, `orbit-camera.svelte.ts`, `canvas-metrics.svelte.ts`).
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

`WorkspaceState` is a thin **composition root**, not a god object: it owns five focused reactive stores and wires the handful of cross-store reactions between them.

- `scene` (`SceneState`, `scene-state.svelte.ts`) — the model, translation, rotation quaternion, `transformsLocked`, and every bounds-derived `$derived` fact (`transformedBounds`, `outsideBuildVolume`, `overlapsSupportMargin`, `isPlaceable`). Setters no-op while `transformsLocked`.
- `supports` (`SupportsState`, `supports-state.svelte.ts`) — the editable `points`, the worker-backed `autoBuild` (an `AutoSupportBuild`), and derived `raftPlan` / `plan` (`generateRaftPlan` over plate-anchored feet, then `generateSupportPlan(points, raftPlan.raftedSupportPointIds)` so rafted feet are dropped).
- `preview` (`PreviewBuild`, `preview-state.svelte.ts`) — the worker-backed voxel-mesh build (unchanged from before the split).
- `export` (`ProjectExport`, `export-state.svelte.ts`) — see **Export** below.
- `workflow` (`WorkflowState`, `workflow-state.svelte.ts`) — the step machine (`WorkflowStep` = `prepare | supports | preview | export`) and the imperative glue between the other four: `interactionMode` (`transform-model` / `place-supports` / `readonly`), `canNavigateTo`/`requestStep` gating, seeding the first auto-support draft on entering `supports`/`preview`, locking `scene.transformsLocked` outside `prepare`, opening the discard dialog on stepping back with supports placed, and (re)requesting the preview build.

Components never reach into `WorkspaceState` directly — they pull individual stores from Svelte context via `workspace-context.ts` (`useScene`, `useSupports`, `usePreview`, `useWorkflow`, `useExport`), set up once by `provideWorkspace(workspace)` in `+page.svelte`. The exceptions are `WorkflowHeader` and `WorkspaceViewport`, which stay prop-driven because their smoke tests render them standalone via `svelte/server`'s `render()` without a context provider. `WorkspaceState`'s constructor takes an optional `createAutoSupportWorker` factory (tests inject a synchronous stub) and an `export` options bag (`ProjectExportOptions`, itself fully injectable for testing — see below); `+page.svelte` calls `workspace.dispose()` on unmount, which disposes `supports.autoBuild`, `preview`, and `export`.

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

### Export: `src/lib/workspace/export-state.svelte.ts` (`ProjectExport`)

The Export step slices the model once more at full (non-supersampled) resolution — independently of the Preview mesh, which it only reuses for the two preview renders — and writes a complete TinyMaker print-project (spec §10).

- `src/lib/slicing/export-slice-worker.ts` (+ `-types.ts`) runs `LayerCoverageRasterizer` off-thread one layer at a time, driven by an explicit `continue` handshake from the main thread (`started` → `layer`×N → `complete`) so the caller can write each PNG before requesting the next and never buffers the whole job in memory. Each layer's coverage mask is rounded to 8-bit and encoded via `src/lib/slicing/grayscale-png.ts` (`encodeGrayscalePng` — a minimal dependency-free grayscale PNG writer using `CompressionStream('deflate')`).
- `ProjectExport.start()` writes straight into a **newly created** directory picked via `window.showDirectoryPicker` (File System Access API); `downloadArchive()` instead packs the same files into an in-memory ZIP (`src/lib/slicing/zip-archive.ts`'s `StoredZipArchive`, a minimal stored-only ZIP32 writer since PNGs are already compressed) and triggers a browser download. Both paths call the same `#sliceLayers` helper. `directorySupported` / `archiveSupported` getters gate which buttons `WorkspaceExport.svelte` shows; Firefox/Safari fall back to ZIP-only.
- `project-files.ts` (`createNewProjectDirectory`, `writeNewProjectFile`) enforces the "never write into an existing project folder, never overwrite a file" guarantee — it's a **create-only** API (checked immediately before every create, since the File System Access API has no atomic exclusive-create) and throws with a message surfaced verbatim in the UI on any collision. `partialProjectPath` tracks a folder that a mid-export failure left behind, so the UI can warn TinySlicer will never reuse it.
- `project-preview.ts` (`renderProjectPreviews`) renders the *already-built* preview mesh through an offscreen orthographic Three.js scene into `preview.png` (640×480) and a cropped `preview_cropping.png` thumbnail, matching known-good TinyMaker projects.
- `src/lib/slicing/tinymaker-project.ts` — `defaultProjectName`/`validateProjectName` (filename-safe transliteration + reserved-character/Windows-device-name checks) and `createTinyMakerGcode`, which reproduces the metadata/comment format (`;key:value` lines) and per-layer table that real TinyMaker firmware expects in `run.gcode`. If the sliced layer count is odd, an extra blank layer PNG is appended before `run.gcode` is written — a firmware quirk (halves the file count at odd totals; see the code comment linking the firmware source) unrelated to the printer's fixed 0.05 mm layer height.

`ProjectExport` is a state machine (`status`: `idle | picking | slicing | saved | error`) fully constructor-injectable (`chooseDirectory`, `createWorker`, `renderPreviews`, `downloadFile`) for testing without real browser APIs. `workflow.canNavigateTo('export')` requires the preview mesh to already be built and ready.

### Supports

- `src/lib/workspace/supports.ts` — post geometry (flared **foot** → cylindrical **shaft** → **junction** → angled tapered **neck**/tip), all dimensions as exported `SUPPORT_*_MM` constants. `generateSupportPlan(points, raftedPointIds?)` turns `SupportPoint[]` into renderable `SupportStructure[]` plus `unresolvedPoints`; rafted points omit the foot (the raft slab replaces it). Handles model-to-model supports via `lowerContactPosition` (no foot on the plate). `SUPPORT_PLATE_EDGE_MARGIN_MM` defines the "supports won't fit" border drawn in the viewport.
- `src/lib/supports/detect-unsupported.ts` — framework-free layer-mask analysis: `dilateBinaryMask` + subtract (`U[i] = M[i] - dilate(M[i-k], allowance)`) to find unsupported pixels, connected-component labeling into `island` vs `overhang` regions, then `suggestCoverageContacts` greedily circle-covers each region using an interior distance transform.
- `src/lib/supports/generate-auto-supports.ts` — glues the rasterizer to the detector to produce a **conservative, deterministic first draft** of contact hits, reusing the exact same post geometry as manual placement. It is explicitly not a printability guarantee; it bails out entirely on non-watertight meshes. Takes an optional `onProgress(completedLayers, totalLayers)` callback (ticks every `AUTO_SUPPORT_PROGRESS_LAYER_STRIDE` scanned layers).
- `src/lib/supports/auto-support-worker.ts` + `auto-support-worker-types.ts` — run `generateAutoSupportHits` off the main thread; `src/lib/workspace/auto-support-state.svelte.ts` (`AutoSupportBuild`) owns the worker lifecycle, request-id/signature dedup, and reactive `status`/`progress`/`error`.
- **Rafts** (`src/lib/supports/raft-plan.ts`, `raft-geometry.ts`; spec §7.3 is authoritative). `generateRaftPlan` single-linkage-clusters plate-anchored support feet within `RAFT_BINDING_DISTANCE_MM`; clusters of ≥ `RAFT_MIN_ISLAND_SUPPORTS` become `RaftIsland`s — a convex-hull core slab plus a 45° removable rim ("dinner-plate brim" for a scraper). `raftedSupportPointIds` feeds `generateSupportPlan`; `raftCrossSectionAtZ` feeds `LayerCoverageRasterizer`; `raftMeshData` (framework-free closed mesh, ear-clipping triangulation) feeds `RaftRenderer`. Recomputed from scratch on every support-set change, like the support plan.
- `src/lib/workspace/support-risk.ts` — cheap mesh-normal overhang highlight for the viewport only; deliberately not a slice-island analysis.

### UI shell

`src/routes/+layout.svelte` just imports `layout.css` + the favicon. `src/routes/+page.svelte` is thin: instantiates `WorkspaceState`, calls `provideWorkspace`, handles STL import + window-wide file drag/drop, and swaps between `WorkspaceViewport` and `WorkspaceExport` based on `workflow.step`. `src/lib/workspace/*.svelte`:

- `WorkflowHeader` — step nav (`WORKFLOW_STEPS`) + file input. Prop-driven (see context note above).
- `WorkspaceViewport` — canvas + orbit camera + gizmo/support interaction + step-transition buttons, all wired through the renderer facade. `CanvasMetrics` (`canvas-metrics.svelte.ts`) tracks its size/DPR via `ResizeObserver`. Prop-driven.
- `WorkspaceExport` — the Export-step panel: project-name input (with validation and a "printer shows only the first 10 characters" preview split), the folder-vs-ZIP buttons, and slicing progress/result/error states driven straight off `useExport()`.
- `WorkspaceAside` (+ `WorkspaceAsideFooter`, `WorkspaceAsidePrinterProfile`) — right-hand panel: scene info, per-step status, and the fixed printer profile. Reads all five stores from context.
- `DiscardSupportsDialog` — confirm before discarding placed supports on step-back.

## Svelte MCP workflow

The Svelte MCP server provides comprehensive Svelte 5 and SvelteKit documentation. Use its tools as follows:

### 1. `list-sections`

Use this first to discover all available documentation sections. It returns a structured list with titles, use cases, and paths.

When asked about Svelte or SvelteKit topics, always use this tool at the start of the chat to find relevant sections.

### 2. `get-documentation`

This retrieves the full documentation content for specific sections and accepts one or multiple sections.

After calling `list-sections`, analyze the returned documentation sections (especially the `use_cases` field), then fetch all sections relevant to the task with `get-documentation`.

### 3. `svelte-autofixer`

This analyzes Svelte code and returns issues and suggestions.

Whenever writing Svelte code, run `svelte-autofixer` before sending it to the user. Keep calling it until no issues or suggestions remain.

### 4. `playground-link`

This generates a Svelte Playground link for provided code.

After completing code that was not written to project files, ask the user whether they want a playground link. Only call this tool after confirmation, and never call it for code written to files in this project.
