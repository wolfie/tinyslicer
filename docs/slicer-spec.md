# TinySlicer specification

## 1. Purpose

TinySlicer is a lightweight, browser-only resin slicer for the TinyMaker printer. It imports a single STL model, lets the user position it and add manual supports, previews the result, and exports a TinyMaker-compatible print job.

The application is implemented in TypeScript with SvelteKit. Model processing, rendering, slicing, PNG encoding, and job generation all happen locally in the browser. No model data is uploaded and no backend is required.

## 2. MVP scope

The MVP must support:

- Importing one binary or ASCII STL file.
- Rendering the model over a representation of the printer's build plate.
- Translating and rotating the model on all three axes.
- Scaling the model uniformly, preserving its proportions.
- Manually adding and removing simple post-style supports.
- Generating a conservative initial set of editable support suggestions for human review.
- Previewing individual sliced layers.
- Slicing the complete printable scene at a fixed 0.05 mm Z interval.
- Exporting numbered PNG layers and a compatible `run.gcode` file as a ZIP archive.

The following are outside the initial scope:

- Automatic orientation or unattended/validated automatic supports.
- Hollowing, infill, drainage holes, and resin traps analysis.
- Mesh repair beyond reporting obvious invalid geometry.
- Multiple independently transformable models.
- Non-uniform scaling.
- File formats other than STL.
- Cloud storage, user accounts, or server-side processing.

## 3. Printer constants

TinySlicer initially targets one fixed printer profile.

| Property               |            Value |
| ---------------------- | ---------------: |
| LCD resolution         |     320 x 240 px |
| Physical X size        |          40.8 mm |
| Physical Y size        |          30.6 mm |
| Maximum Z              |            60 mm |
| Pixel pitch            | 0.1275 mm square |
| File-format Z interval |          0.05 mm |

The 60 mm Z limit is derived from the printer's example jobs. It should remain a named profile constant so that it can be corrected without changing slicing code.

The application does not provide a 0.1 mm slicing mode. TinyMaker always interprets the image sequence on a 0.05 mm grid. When the printer hardware is configured for a 0.1 mm step, the firmware skips alternating images; TinySlicer still exports the complete 0.05 mm sequence.

## 4. Coordinates and units

- All internal geometry and UI measurements use millimetres.
- STL is unitless, so imported coordinates are assumed to be millimetres.
- The build plate occupies X = 0..40.8 mm and Y = 0..30.6 mm.
- Z = 0 is the build-plate surface and positive Z points into the printable volume.
- The mapping from build coordinates to pixels must use the same 0.1275 mm pitch on both axes.
- The exact X/Y image orientation and mirroring convention must be isolated in the export transform so that it can be changed without affecting the workspace coordinate system.

TinySlicer must warn when any printable geometry is below the plate or outside the X, Y, or Z bounds. Export should be blocked until the scene fits in the printable volume.

## 5. STL import

The importer must:

- Accept `.stl` files selected with a file picker or drag and drop.
- Detect and parse both binary and ASCII STL data.
- Produce indexed or non-indexed triangle geometry suitable for rendering and plane intersection.
- Calculate vertex normals for display when useful.
- Calculate the model's axis-aligned bounding box, dimensions, and triangle count.
- Reject empty files and files with no valid triangles with a clear message.
- Retain the original filename for the job name and G-code metadata.

After import, the model should be centred over the build plate and lowered so that its lowest point is at Z = 0. The user can then alter this placement.

### 5.1 Binary STL

Binary STL is a supported input format. Its byte layout is:

1. An arbitrary 80-byte header.
2. A little-endian unsigned 32-bit triangle count.
3. One 50-byte record per triangle, containing:
   - Three little-endian 32-bit floats for the facet normal.
   - Three vertices, each containing three little-endian 32-bit floats.
   - One little-endian unsigned 16-bit attribute field.

For a declared triangle count `T`, the expected file size is `84 + 50 * T` bytes. The importer must validate the count and expected size before allocating geometry buffers. It must reject truncated data and unreasonable counts instead of reading beyond the supplied buffer or exhausting browser memory.

The 80-byte header is opaque and must not be interpreted as geometry. In particular, a binary header is allowed to begin with `solid`, so that word alone cannot distinguish ASCII STL from binary STL. Format detection should first validate the binary triangle count and expected byte length, then fall back to ASCII parsing when the binary structure is not valid.

Facet normals in the file are advisory and may be zero or incorrect. TinySlicer should calculate normals from vertex positions for operations that require reliable normals. The attribute field is normally zero; non-standard color encodings stored in it are outside the MVP and should be ignored.

Like ASCII STL, binary STL contains no standard unit declaration. Coordinates are assumed to be millimetres.

## 6. 3D workspace

The workspace must provide:

- A perspective 3D view of the model, supports, build plate, and build-volume bounds.
- Orbit, pan, and zoom camera controls.
- Model selection and a clear indication of the current editing mode.
- Transform gizmos and numeric inputs for translation and rotation on X, Y, and Z.
- A single uniform scale value.
- Commands to centre the model on the plate, lower it to the plate, and reset its transform.
- Live model dimensions and out-of-bounds feedback after every transform.

Transforms must not destructively rewrite the imported source geometry. Rendering, picking, bounds checking, support placement, and slicing must all observe the same composed world transform.

## 7. Manual supports

### 7.1 Interaction

In support mode, clicking a valid point on the rendered model creates one support whose tip contacts the picked surface position. Raycasting supplies the world-space contact point and surface normal.

Each support must be selectable and removable. Undo and redo should cover support creation, deletion, and transform changes. A selected support may expose a handle for adjusting the vertical shaft's X/Y position while retaining its model contact point.

### 7.2 Initial geometry

A support consists of:

1. A flared foot on the build plate.
2. A vertical cylindrical shaft.
3. An angled neck leading toward the selected model point.
4. A tapered contact tip for the final 1-2 mm near the model.

Initial defaults:

| Part                   |          Default |
| ---------------------- | ---------------: |
| Shaft diameter         | 1.275 mm (10 px) |
| Foot diameter          |           2.0 mm |
| Tapered neck length    |           1.5 mm |
| Neck diameter at shaft |           0.8 mm |
| Contact diameter       |           0.4 mm |

These dimensions must be central constants even if the MVP does not expose them as user settings.

The support should use the picked surface normal to choose a sensible contact direction. The main shaft remains vertical. Invalid placements, including a tip below the plate or a zero-height shaft, must be rejected or visibly reported.

Supports are independent scene objects. A costly 3D boolean union with the STL is not required; their cross-sections can be combined with the model at rasterization time.

### 7.3 Automatic rafts

Rafts are derived from the support set, not placed by hand. They are recomputed
from scratch whenever the support set changes — after automatic generation and
after every manual add, move, or delete — the same way the support plan is.

- **Clustering.** Only plate-anchored supports (those with a flared foot, not
  model-to-model posts) take part. Their foot centres — the point where the
  vertical shaft would meet the plate — are single-linkage clustered: two feet
  join the same cluster when their centres are within `RAFT_BINDING_DISTANCE_MM`
  (7 mm), transitively. Clusters smaller than `RAFT_MIN_ISLAND_SUPPORTS` (2) get
  no raft and keep their normal foot.
- **Core slab.** Each qualifying cluster becomes one raft island. Its core is the
  convex hull of the member foot centres rounded outward by `RAFT_CORE_RADIUS_MM`
  (1.5 mm), extruded `RAFT_CORE_LAYER_COUNT` layers (6 × 0.05 = 0.30 mm) as a
  flat slab — just enough to bond the feet and the plate. Member supports drop
  their foot and start the shaft at the slab top.
- **Removable rim.** Around the core perimeter runs a rim that leans up and
  outward at `RAFT_BRIM_ANGLE_DEGREES` (45°) for `RAFT_BRIM_WIDTH_MM` (1.5 mm),
  like the brim of a dinner plate. Its underside is a 45° overhang (self-
  supporting in resin), so there is a wedge of air between the rim and the plate:
  a scraper slides into that wedge, catches the rim, and levers the raft — and
  the model — off. The rim is dropped entirely on an island whose core comes
  within `RAFT_BRIM_WIDTH_MM + RAFT_BRIM_PLATE_CLEARANCE_MM` of a plate wall
  (it leans outward and would otherwise run off the plate); such an island prints
  as a bare slab.
- **Plate margin.** The rim only ever leans toward the plate interior, and its
  clamp keeps it clear of every wall, so a raft never needs more plate-edge
  clearance than the lone-support case already reserves in
  `SUPPORT_PLATE_EDGE_MARGIN_MM`; that constant is unchanged. A future check on
  the assembled raft footprint (rather than the per-foot proxy) is still worth
  adding to guard against tuning that pushes the core past the foot radius.
- **Slicing.** `raftCrossSectionAtZ` returns the island's filled rings at any
  height — one solid ring up to the core height, then an outer ring plus a hole
  once only the rim survives, marching outward until it closes.
  `LayerCoverageRasterizer` composites those rings into the supersampled mask
  with even-odd parity for every layer the raft reaches, exactly alongside the
  model and the support cross-sections, so the sliced preview and the PNG export
  show the raft identically. Nothing else special-cases the raft in slicing — it
  is just more printable area.

All raft geometry lives in framework-free modules with co-located tests
(`src/lib/supports/raft-plan.ts`, `raft-geometry.ts`); the renderer and the
rasteriser only consume `RaftIsland`s.

## 8. Slicing

### 8.1 Layer enumeration

Layer spacing is a hard-coded 0.05 mm invariant.

For a scene whose highest printable point is `maxZ`:

- `layerCount = ceil(maxZ / 0.05)`
- Exported image names are plain, one-based ordinals: `1.png`, `2.png`, ..., `N.png`.
- Image `i.png` represents the slicing plane at `z = i * 0.05 mm`.
- Filenames have no zero padding, embedded Z value, or other metadata.

The matching G-code layer record is zero-based: image `i.png` corresponds to `LAYER_START:i-1` and `currPos:i*0.05`.

### 8.2 Cross-section generation

For each slicing plane, the slicer must:

1. Intersect the plane with all relevant transformed model triangles.
2. Convert triangle intersections into 2D line segments.
3. Join segments into closed contours within a documented numerical tolerance.
4. Preserve nested contours so that holes remain empty.
5. Add the cross-sections of all supports intersecting the plane.
6. Rasterize the combined printable area to the printer mask.

Malformed or non-manifold meshes may produce open contours. The slicer should report that condition and avoid silently producing an obviously corrupt job. A future mesh-repair subsystem is not part of the MVP.

### 8.3 Layer images

Every layer image must be:

- PNG format.
- Exactly 320 x 240 pixels.
- 8-bit grayscale.
- Black (`0`) for unexposed pixels.
- White (`255`) for fully exposed pixels.
- Coverage-antialiased at contour edges, matching the general form of the supplied example jobs.

Antialiasing may be implemented by supersampling and downsampling. The algorithm must be deterministic for a given scene.

## 9. Slice preview

Before export, the user must be able to inspect the generated mask for any layer using a slider or numeric layer input. The preview must show:

- Layer ordinal.
- Z position in millimetres.
- The 320 x 240 mask at an enlarged nearest-neighbour display scale.
- Model and support contributions together.

Returning to the 3D workspace must not discard the loaded model, transforms, or supports.

## 10. TinyMaker job export

### 10.1 Archive layout

The browser exports a ZIP archive containing one job directory:

```text
job-name/
  1.png
  2.png
  ...
  N.png
  run.gcode
  preview.png
  preview_cropping.png
```

The user extracts this directory onto the printer's removable storage. Direct directory writing may be added later as an optional enhancement for browsers that support the File System Access API.

### 10.2 `run.gcode`

The supplied TinyMaker examples contain metadata and empty per-layer blocks, with no executable motion commands. TinySlicer must reproduce that structure.

Required fixed profile metadata includes:

```text
;machineType:default
;layerHeight:0.05
;resolutionX:320
;resolutionY:240
;machineX:40.8
;machineY:30.6
;machineZ:60
;projectType:LCD_mirror
;mirror:1
```

The initial exposure and motion defaults observed in the example jobs are:

| Setting            | Default |
| ------------------ | ------: |
| Normal exposure    |    13 s |
| Bottom exposure    |    38 s |
| Bottom layers      |       4 |
| Normal lift height |    2 mm |
| Normal lift speed  |     100 |
| Normal drop speed  |     100 |
| Light-off times    |       0 |

For `N` images, the header contains `;totalLayer:N`, followed by `N` blocks:

```text
;LAYER_START:0
;currPos:0.05

;LAYER_END
```

The final block is `LAYER_START:N-1` with `currPos:N*0.05`. Numeric formatting should avoid floating-point artifacts such as `0.15000000000000002`.

The example metadata fields for volume, weight, price, resin, and estimated print time are informational. TinySlicer may calculate reasonable values where practical, but they must not affect mask generation.

### 10.3 Preview files

The example jobs include a full preview and a cropped preview. TinySlicer should export both for compatibility with the printer's job browser. Their exact required dimensions and orientation still need validation against the device; preview generation must therefore remain separate from layer-mask generation.

## 11. Application architecture

- SvelteKit and TypeScript provide the application shell and UI.
- WebGL, through Three.js or a compatible Svelte integration, renders and picks the 3D scene.
- CPU-heavy parsing and slicing should run in Web Workers so the interface remains responsive.
- Worker messages must use typed data contracts and transferable buffers where useful.
- Layer PNGs should be streamed into the ZIP where possible instead of retaining every uncompressed image in memory.
- Generated object URLs and GPU resources must be released when replaced or when the workspace is destroyed.
- Core geometry, slicing, G-code generation, and filename enumeration should be framework-independent TypeScript modules with unit tests.

The application must continue to function after its static assets have loaded without making network requests.

## 12. Error handling

The UI must provide actionable errors for:

- Unsupported or corrupt STL files.
- Empty geometry.
- Models or supports outside the build volume.
- Models exceeding the 60 mm Z limit.
- Open contours or slicing failures.
- Browser memory exhaustion or worker failure.
- PNG or ZIP generation failure.

Long operations must show progress and remain cancellable. A failed export must not destroy the current workspace.

## 13. Acceptance criteria

The MVP is complete when:

1. A user can import a valid binary or ASCII STL without sending it over the network.
2. The mesh is rendered at the correct physical scale over a 40.8 x 30.6 mm plate.
3. Translation, three-axis rotation, and uniform scale affect both rendering and slicing consistently.
4. The user can place and remove vertical post supports with angled tapered tips.
5. Slice preview correctly displays arbitrary model and support layers.
6. Export creates exactly one 320 x 240 grayscale PNG for every 0.05 mm layer.
7. PNG filenames are the plain ordinals `1.png` through `N.png`.
8. `run.gcode` contains matching metadata and zero-based layer records.
9. The exported job can be extracted to removable storage and recognized by TinyMaker.
10. Slicing runs without freezing normal UI interaction on the supported desktop browsers.

## 14. Hardware validation still required

Before declaring print compatibility final, test an asymmetric calibration job to establish:

- Whether layer pixels need to be mirrored or rotated in addition to `mirror:1` metadata.
- Which physical edge corresponds to pixel `(0, 0)`.
- Whether the printer job browser requires both preview files and any exact preview dimensions.
- Whether grayscale edge antialiasing behaves as expected on the LCD.

These checks must not change the fixed 0.05 mm layer enumeration or ordinal filename scheme.
