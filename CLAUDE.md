# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

TinySlicer is a **browser-only resin slicer** for the fixed "TinyMaker" printer profile. It imports one STL, lets the user place and rotate it, adds supports, and (per spec) previews layers and exports a TinyMaker ZIP job. Everything — parsing, rendering, slicing, PNG/G-code generation — runs client-side with no backend and no network access after assets load. `docs/slicer-spec.md` is the authoritative product/format spec; `docs/*research*.md` and `docs/support-density*.md` are the reasoning behind the support algorithms.

Current implementation covers the `prepare` and `supports` workflow steps; `preview` and `export` are specified but not built yet.

## Commands

Package manager is **pnpm** (`engine-strict=true`, committed `pnpm-lock.yaml`). Scripts are also runnable as `pnpm <script>`.

- `pnpm dev` — Vite dev server
- `pnpm build` / `pnpm preview` — production build (adapter-auto) and preview
- `pnpm check` — `svelte-check` type checking (run this, not `tsc`); `pnpm check:watch` to watch
- `pnpm lint` — `prettier --check` + `eslint`
- `pnpm format` — `prettier --write`
- `pnpm test` — run the full Vitest suite once
- `pnpm test:unit` — Vitest in watch mode

### Running a single test

Vitest is configured with two **projects** (`vite.config.ts`):

- `server` — Node environment, matches `src/**/*.{test,spec}.ts` **except** `*.svelte.*`
- `client` — real browser via `@vitest/browser-playwright` (chromium, headless), matches `src/**/*.svelte.{test,spec}.ts`

Run one file: `pnpm exec vitest run src/lib/slicing/model-layer-masks.spec.ts`
Filter by name: `pnpm exec vitest run -t "rasterizes a cube"`
Restrict to a project: append `--project server` or `--project client`.

Browser tests require Playwright's chromium to be installed (`pnpm exec playwright install chromium`).

`test.expect.requireAssertions` is **on** — every test must make at least one assertion.

## Conventions

- **Svelte 5 runes mode is forced** for all non-`node_modules` files. Use `$state` / `$derived` / `$props` / `$effect`. Reactive logic outside components lives in `*.svelte.ts` modules (e.g. `workspace-state.svelte.ts`, `orbit-camera.svelte.ts`).
- Prettier: tabs, single quotes, no trailing commas, width 100. ESLint disables `no-undef` (TS handles it).
- `$lib` → `src/lib`. Path aliases handled by SvelteKit, not tsconfig.
- When writing/editing Svelte code, the Svelte MCP server is available (see `AGENTS.md`): use `list-sections` + `get-documentation` for Svelte 5 / SvelteKit questions and run `svelte-autofixer` on Svelte code until it's clean.

## Architecture

The design principle (from the spec): **core geometry, slicing, and support logic are framework-independent TypeScript modules with co-located unit tests.** Svelte only provides the shell and imperative glue to Three.js. Keep new geometry/slicing logic in plain `.ts` with a `.spec.ts` beside it.

### The one printer constant source

`src/lib/printer/tinymaker.ts` — `TINYMAKER_PROFILE` (resolution 320×240, build volume 40.8×30.6×60 mm, layer height 0.05 mm). Everything derives build-volume and pixel-pitch math from here; never hard-code these numbers elsewhere.

Coordinate system: millimetres everywhere, `Z = 0` is the build plate, `+Z` into the printable volume. On import the model is centered on the plate and dropped so its lowest point sits at `Z = 0`.

### Central state: `src/lib/workspace/workspace-state.svelte.ts`

`WorkspaceState` is the reactive hub the page (`src/routes/+page.svelte`) instantiates once. It holds the model, translation, rotation quaternion, support points, and current `WorkflowStep` (`prepare | supports | preview | export`). Almost everything else is `$derived`: transformed bounds, out-of-bounds / support-margin checks, `interactionMode`, and the `supportPlan`. `requestStep('supports')` triggers auto-support generation on first entry; stepping back with placed supports opens the discard dialog.

### Rendering: `src/lib/workspace/build-volume-renderer/`

`build-volume-renderer.ts` (parent file) is a **facade** that re-exports the subfolder and exposes canvas-keyed imperative functions. `BuildVolumeViewport` (one per `<canvas>`, tracked in a `WeakMap`, disposed on unmount) owns the Three.js `Scene`, camera, and sub-renderers: `BuildVolumeScene` (plate/grid/bounds/rulers/support-margin), `RenderedModel`, `SupportRenderer`, `TransformGizmo`, `ModelInteractionController` (raycast picking + drag gizmos). Rendering is rAF-coalesced via `schedule(state)` taking a plain `BuildVolumeRenderState`.

### Model transforms are non-destructive

Imported `positions` (a `Float32Array` of triangle triples) are never rewritten after the initial centering. Translation + a rotation **quaternion** (`ModelRotation` is `{x,y,z,w}`) are re-applied about the model's bounding-box center by every consumer independently: the renderer, the rasterizer, bounds math (`model-transform.ts`), and the support-risk preview. If you add a consumer of transformed geometry, reuse `model-transform.ts` helpers so the composed transform stays consistent.

### Slicing: `src/lib/slicing/model-layer-masks.ts`

`ModelLayerMaskRasterizer` scanline-rasterizes the transformed mesh once in its constructor, caching **sorted vertical (Z) ray crossings per pixel** (half-open edge rule; even-cluster merging so touching solids don't create spurious transitions). `createLayerMask(i)` / `masks()` then produce binary `BinaryLayerMask`s lazily (so callers can use a rolling window). Layers are the fixed 0.05 mm grid; image `i.png` (one-based) is the plane at `z = i * 0.05`. `verticalIntervalsAtPixel` exposes the cached spans for support contact math. `diagnostics.oddIntersectionPixelCount > 0` means a non-watertight mesh at the sampled pixels.

### Supports

- `src/lib/workspace/supports.ts` — post geometry (flared **foot** → cylindrical **shaft** → **junction** → angled tapered **neck**/tip), all dimensions as exported `SUPPORT_*_MM` constants. `generateSupportPlan(points)` turns `SupportPoint[]` into renderable `SupportStructure[]` plus `unresolvedPoints`. Handles model-to-model supports via `lowerContactPosition` (no foot on the plate). `SUPPORT_PLATE_EDGE_MARGIN_MM` defines the "supports won't fit" border drawn in the viewport.
- `src/lib/supports/detect-unsupported.ts` — framework-free layer-mask analysis: `dilateBinaryMask` + subtract (`U[i] = M[i] - dilate(M[i-k], allowance)`) to find unsupported pixels, connected-component labeling into `island` vs `overhang` regions, then `suggestCoverageContacts` greedily circle-covers each region using an interior distance transform.
- `src/lib/supports/generate-auto-supports.ts` — glues the rasterizer to the detector to produce a **conservative, deterministic first draft** of contact hits, reusing the exact same post geometry as manual placement. It is explicitly not a printability guarantee; it bails out entirely on non-watertight meshes.
- `src/lib/workspace/support-risk.ts` — cheap mesh-normal overhang highlight for the viewport only; deliberately not a slice-island analysis.

### UI components (`src/lib/workspace/*.svelte`)

`WorkflowHeader` (step nav + file input), `WorkspaceViewport` (canvas + orbit camera + gizmo/support interaction, wired through the renderer facade), `DiscardSupportsDialog`. `src/lib/vitest-examples/` is scaffold from `sv create` and can be ignored/removed.
</content>
</invoke>
