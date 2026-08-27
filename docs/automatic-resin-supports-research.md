# Automatic support generation for resin printing

Research date: 2026-08-25

## Summary

TinySlicer should begin with a slice-based island and overhang detector that generates independent, collision-checked post supports. This approach is comparatively simple to validate, fits the planned layer-mask pipeline, and reuses the manual support geometry described in the slicer specification.

Tree supports are a useful later optimization, but they add difficult routing, collision, load propagation, and branch-sizing problems. On TinyMaker's small 40.8 x 30.6 mm build plate, reliable independent posts are more valuable initially than aggressively minimizing support material.

There does not appear to be a popular, mature, permissively licensed resin slicer with production-proven automatic supports. The established open-source implementations are predominantly GPL or AGPL. There are, however, permissively licensed research and experimental projects from which algorithms or narrowly scoped code can be borrowed.

## Recommended initial algorithm

### 1. Detect unsupported regions from layer masks

Let `M[i]` be the binary model mask at layer `i`. A layer below can support a limited horizontal expansion determined by the layer height and configured overhang angle. An approximate supportable region is:

```text
S[i] = dilate(M[i - k], k * layerHeight / tan(overhangAngle))
U[i] = M[i] - S[i]
```

Connected components of `U[i]` identify new islands and unsupported growth. This offset-and-subtract approach is widely used in slicers and is described in the [CuraEngine support-area documentation](https://ultimaker.github.io/CuraEngine/docs/generating_areas.html).

The calculation needs special care at TinyMaker's resolution:

- Layer height: 0.05 mm.
- Pixel pitch: 0.1275 mm.
- At a 45-degree threshold, allowable expansion is 0.05 mm per layer.
- That is only about 0.392 pixels per layer.

A one-layer binary dilation would therefore round poorly. Good implementation options are:

1. Compare against a layer several steps below. At 45 degrees, a three-layer lookback gives about 1.18 pixels of allowance.
2. Use a Euclidean distance transform and retain distances in millimetres rather than integer pixels.
3. Analyze supersampled masks, although that increases slicing cost.
4. Use exact contour offsets once a robust contour slicer exists.

A multi-layer lookback or distance transform is likely the best first implementation.

The detector should distinguish at least:

- A newly appearing connected component, which is a mandatory island/local-minimum support case.
- Unsupported expansion of an existing component.
- Very small components below a configurable physical-area threshold.
- Regions already covered by previously selected contact points.

### 2. Select model contact points

For each unsupported connected component:

1. Always seed at least one contact for a new island.
2. Compute a distance transform inside the component.
3. Select the farthest interior pixel as the next contact.
4. Mark the area within the configured support coverage radius as covered.
5. Repeat until all significant pixels are covered or a safety limit is reached.

This is a greedy disk-cover approximation. It has a useful property for a slicer: after completion, every retained unsupported pixel is within the configured coverage radius of a support point.

The component centroid should not be used blindly because the centroid of a concave component may fall outside it. A distance-transform maximum is both inside the component and relatively far from fragile edges.

For large supported regions, additional contacts should be placed near extremities. This expands the support polygon and provides better resistance to peel-induced torque than a cluster near the centroid.

Each 2D candidate must be mapped back to an actual point on the model's underside. This can be done with a spatially indexed ray intersection against the transformed triangles. The same composed world transform must be used by rendering, contact generation, picking, bounds checks, and slicing.

### 3. Route supports to the build plate

The first implementation should attempt a simple bed support for every contact:

1. Follow the picked surface normal for the tapered contact tip and neck.
2. Continue with the existing vertical shaft and flared foot design.
3. Test the complete route against model layer masks with sufficient clearance for the support radius.
4. If a vertical route collides, search nearby foot positions within a configured maximum shaft-angle cone.
5. If no safe route exists, leave the candidate unresolved and show it to the user for manual correction.

The support remains an independent scene primitive. It does not need to be boolean-unioned with the model; model and support cross-sections can be combined during mask rasterization as already proposed in the slicer specification.

Automatic generation must remain editable. The user should be able to remove, move, or replace generated supports using the same undo/redo model as manual supports.

### 4. Reinforce supports using inexpensive load proxies

Pure overhang detection answers whether a region can grow from the layer below, but not whether the resulting structure can survive separation from the release film. Bottom-up resin printing introduces peel forces related to layer cross-section and their moment about the existing supports.

Useful first-order reinforcement signals include:

- Unsupported component area.
- Maximum downstream cross-sectional area carried by an island.
- Distance between the supported area's centroid and its support polygon.
- Support height.
- Number of contacts or branches carried by a shaft.
- Rapid increases in exposed area between adjacent layers.

These can control contact count, contact diameter, shaft diameter, and whether braces are added. Full physical simulation is not required for an initial implementation. More advanced research explicitly optimizes support placement against traction force, such as [Auto-Support: Traction Force Constrained Support Structures Optimization for Bottom-Up Vat Photopolymerization](https://papers.ssrn.com/sol3/Delivery.cfm/a1c660e9-e070-4f3b-8a64-41435149b384-MECA.pdf?abstractid=4962169&mirid=1&type=2).

## More advanced algorithms

### Cone-constrained tree supports

The classic tree-support method from Vanek, Galicia, and Benes assigns a downward cone to each model contact. The cone describes all branch directions that remain printable. The generator sweeps contacts from top to bottom and greedily merges branches at feasible cone intersections, approximating a constrained Euclidean Steiner tree.

A TinySlicer implementation would:

1. Sort contact nodes from high to low.
2. Associate a maximum branch-angle cone with every active node.
3. Find nearby pairs whose cones intersect.
4. Choose a high, short, collision-free merge point.
5. Replace the pair with the merged node and repeat.
6. Route remaining roots to the plate or, later, to safe points on the model.
7. Increase branch diameter as supported area or leaf count accumulates downward.
8. Add cross-braces between tall nearby trunks.

The method was developed and tested primarily for FDM, but its constrained tree construction is applicable to resin scaffolds. See [Clever Support: Efficient Support Structure Generation for Digital Fabrication](https://onlinelibrary.wiley.com/doi/10.1111/cgf.12437).

This should follow reliable independent posts rather than precede them. Trees save resin but make failure analysis and manual editing considerably harder.

### Directed layered-depth images

The directed z-LDI method represents all mesh intersections along each build-direction ray and connects them into a graph describing how regions can inherit support. A greedy graph traversal selects support points while ensuring that local minima are included. It avoids the main weakness of simple mesh-normal sampling: missing small or topologically awkward islands.

This method is described in [Free-Floating Support Structure Generation](https://www.sciencedirect.com/science/article/abs/pii/S0010448520301019). It is attractive as a long-term robust detector, but it requires a more complicated depth-intersection representation and graph implementation than TinySlicer's first automatic support generator needs.

### Mesh-normal sampling

Another common family of algorithms marks downward-facing triangles using a critical angle, samples those triangles using a grid or Poisson-disk pattern, and projects supports toward the build plate.

This is fast and useful for supplementing broad overhangs, but it should not be the only detector. Mesh-based sampling can miss exact local minima and small islands; noisy tessellation can also create excessive candidates. A layer- or LDI-based island pass is still required.

## Permissively licensed sources

### FreeFloating

- Repository: [regrow1123/FreeFloating](https://github.com/regrow1123/FreeFloating)
- License: MIT
- Status at research time: research implementation, three commits and very limited adoption
- Languages and dependencies: C++, GLSL, OpenGL, OpenCV, OpenMesh, GLM, and Boost Graph

This repository accompanies the Free-Floating paper. It implements directed z-LDI construction, graph-based support-point selection, and comparison implementations of earlier approaches, including the Vanek method.

It is the strongest permissive source for algorithm provenance. It is not directly portable to a browser-only TypeScript application, but the graph construction and greedy coverage logic can be independently ported. If substantial source is copied or translated, retain its MIT copyright and permission notice.

### jagers-HHMI/Resin-Slicer

- Repository: [jagers-HHMI/Resin-Slicer](https://github.com/jagers-HHMI/Resin-Slicer)
- Support implementation: [resin_slicer/supports.py](https://github.com/jagers-HHMI/Resin-Slicer/blob/main/resin_slicer/supports.py)
- License: MIT
- Status at research time: new and effectively unadopted
- Language: Python, with an Electron-based user interface

Its implementation includes:

- Multi-layer overhang lookback.
- Binary-mask dilation and subtraction.
- Connected-component island detection.
- Candidate spacing and de-duplication.
- Surface-normal recovery.
- Collision-checked routes to the bed or another model surface.
- Rafts, feet, tips, and braces.

The code exists and is readable, but it should be treated as experimental reference material rather than a proven upstream dependency. At the research date the repository had zero stars and little history, and its package metadata named `Codex` as the author. Small routines or concepts may be useful after writing independent tests, but the implementation should not be assumed to have extensive physical-print validation.

### Formlabs hackathon-slicer

- Repository: [Formlabs/hackathon-slicer](https://github.com/formlabs/hackathon-slicer)
- License: MIT
- Purpose: browser-based DLP slicing using WebGL and the stencil buffer

It does not generate automatic supports. Its value to TinySlicer is the browser-side GPU slicing technique. The repository describes itself as a two-day demonstration and explicitly warns that it is not industrial-strength software.

### webgl-slicer

- Repository: [byronxu99/webgl-slicer](https://github.com/byronxu99/webgl-slicer)
- License: MIT
- Purpose: browser-side WebGL slicing for an experimental variable-angle DLP printer

It does not perform automatic support placement. It includes generation and slicing of straight and tapered beam primitives, which may be useful as reference material for rendering or rasterizing support shafts and tips.

### uv3dp

- Repository: [ezrec/uv3dp](https://github.com/ezrec/uv3dp)
- License: MIT
- Purpose: resin printer layer-file decoding, encoding, conversion, and image manipulation
- Status: explicitly unmaintained

It does not generate supports. Its format implementations would be relevant if TinySlicer later targets CTB, SL1, Photon, or other packaged resin formats. They offer little immediate value while TinySlicer exports TinyMaker PNG layers and `run.gcode`.

## Copyleft projects to study without copying code

The most capable open-source resin tools are copyleft:

| Project | License | Relevant capability |
| --- | --- | --- |
| [PrusaSlicer](https://github.com/prusa3d/PrusaSlicer) | AGPL-3.0-or-later | Mature SLA contact generation, support trees, pads, and slicing pipeline |
| [UVtools](https://github.com/sn4k3/UVtools) | AGPL-3.0 | Layer analysis for islands, overhangs, resin traps, suction cups, and other print risks |
| [DragonFruit](https://github.com/Open-Resin-Alliance/DragonFruit) | AGPL-3.0 | New experimental island, overhang, tree, cavity, and bracing auto-support pipeline |
| [mslicer](https://github.com/connorslade/mslicer) | GPL-3.0 | Fast MSLA slicing and several output formats; support placement is not currently its strength |

These projects are useful for understanding expected features, terminology, settings, and failure cases. Their implementation should not be copied or closely translated into a permissively licensed TinySlicer unless the project is willing to adopt the applicable copyleft terms.

Algorithms and implementation code are not the same thing. Published algorithm descriptions can generally guide a fresh implementation, while copying code invokes its license. Patent rights are a separate issue, and this note is not legal advice. A prudent process is to document algorithm sources, implement from the papers or permissive references, and preserve all required notices for any MIT-derived code.

## Proposed TinySlicer architecture

Automatic-support logic should remain independent of Svelte and the Three.js renderer:

```text
src/lib/supports/
  detect-unsupported.ts
  sample-contact-points.ts
  route-supports.ts
  support-plan.ts
  support-plan.spec.ts
```

Suggested responsibilities:

- `detect-unsupported.ts`: layer history, mask offsets or distance transforms, connected components, and island ancestry.
- `sample-contact-points.ts`: greedy coverage, physical spacing, extremity reinforcement, and candidate priorities.
- `route-supports.ts`: transformed-mesh queries, shaft-angle search, clearance checks, and unresolved-candidate reporting.
- `support-plan.ts`: framework-independent contacts, feet, shafts, tips, branches, braces, settings, and validation results.

Detection and routing should run in a Web Worker. Worker messages should use typed contracts and transferable buffers. Only a small rolling window of model masks needs to remain resident for detection; the complete uncompressed layer stack should not be retained unnecessarily.

`build-volume-renderer.ts` should consume and display a `SupportPlan`, not own the generation algorithm. The slicing pipeline should consume the same plan and rasterize its analytic support primitives. That prevents preview/export discrepancies and follows the architecture already described in `docs/slicer-spec.md`.

Support planning also needs a single shared transform utility. Candidate detection, triangle raycasts, rendering, bounds checks, and final slicing must all observe exactly the same model rotation and translation.

## Suggested implementation sequence

1. Implement layer-mask generation and an unsupported-region overlay without creating geometry.
2. Add connected-component ancestry so every newly appearing island is reported.
3. Add deterministic greedy contact-point selection and visualization.
4. Map candidates to precise underside contacts on the transformed mesh.
5. Generate collision-checked vertical posts using the manual support primitives.
6. Add automatic/manual editing, undo/redo, and unresolved-region warnings.
7. Add area- and height-based support weights, stronger primary contacts, and braces.
8. Add angled bed routing for vertical paths that collide with the model.
9. Add cone-based tree merging only after the independent-post generator is physically reliable.

## Testing and validation

Useful synthetic fixtures include:

- A model resting directly on the plate, which should not receive base supports.
- A lifted sphere, which has one clear initial local minimum followed by growing overhangs.
- An inverted cone and an upright cone.
- A T-shaped bridge.
- Two disconnected islands that later merge.
- A concave U-shaped region whose centroid lies outside the printable component.
- A thin tilted slab.
- A hollow or cavity-like mesh where a direct bed route collides with the shell.
- A noisy, highly tessellated surface.

Automated invariants should include:

- Every significant model component either inherits support from an earlier layer or has a generated/manual contact.
- Every generated route respects the build volume and configured collision clearance.
- Contact spacing and per-island limits are expressed in millimetres, not pixels.
- Generation is deterministic for identical geometry, transforms, and settings.
- Preview and export rasterize identical support geometry.
- Cancelling or failing generation does not discard the model or manual supports.

Physical validation remains essential. Initial presets should be conservative, generated supports should be presented as an editable starting point, and calibration models should be tested across representative resin, exposure, lift-speed, and release-film conditions before claiming production reliability.
