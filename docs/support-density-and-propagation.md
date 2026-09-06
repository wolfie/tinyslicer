# Support density and upward support propagation

Research date: 2026-08-27

## Summary

Support placement should be treated as three related but distinct problems:

1. **Topology:** every printed island needs a continuous load path to the build plate.
2. **Coverage:** risky material should remain within a calibrated distance of a direct or inherited support.
3. **Capacity:** the contacts and shafts carrying a region must survive its separation load and overturning moment.

A fixed support-density percentage hides these distinctions. TinySlicer should instead generate a conservative, deterministic starting set from physical-unit parameters and leave the user responsible for reviewing and editing it.

## Findings from the literature

### Coverage radius is a useful approximation

Cao et al. formulate bottom-up vat-photopolymer support placement as a **capacity-constrained circle-covering problem**. The geometric constraint requires circles of radius `d_self-support` around support points to cover the overhang region. A second constraint limits the traction load assigned to each support's Voronoi region. Their optimizer adds and redistributes supports until both constraints are met.

This strongly supports using an explicit `coverageRadiusMm`, but it does not make the radius a material constant. It is a calibrated process parameter affected by:

- Contact and shaft diameters.
- Support height and bracing.
- Part thickness and local stiffness.
- Resin, exposure, layer height, temperature, and lift settings.
- Release-film behavior and current-layer separation load.
- Whether the objective is mere print survival or dimensional accuracy.

Alpöz, Akan, and Akan experimentally compared 3, 5, and 7 mm support spacing for one MSLA dental workflow. Global dimensional error increased with spacing, while the strength and shape of the effect varied by model region. The 3 mm group was generally most accurate, but the authors explicitly avoid presenting it as a universal setting.

Manufacturer design rules show the same geometry dependence. Formlabs publishes different limits for unsupported overhangs, horizontal beam spans, walls, and wires. These values are not transferable to TinyMaker, but they demonstrate why one global spacing cannot describe both a thin sheet and a stiff beam.

### Support inheritance is directional

A support contact beginning at layer `i` cannot repair or stabilize layers below `i`; they have already been exposed and separated. It can seed a supported region at layer `i`, and later layers may inherit that support through continuously cured material.

Jang, Moon, and Lee represent this relationship as a directed z-layered-depth-image graph. Their method guarantees inclusion of local minima, greedily limits additional contacts, and later reinforces the result for model weight and structural stability. This supports the following priorities:

- A new island or downward local minimum is a mandatory topological seed.
- A seed is not necessarily mechanically sufficient as its downstream component grows.
- Components can share inherited support after they merge.
- Proximity in XY alone does not establish a load path across a gap.
- A valley is safe only when layer ancestry and available support capacity say it is safe.

### Geometry and mechanics must remain separate

The circle-covering model answers whether a risky area is close enough to a contact. It does not answer whether that contact can carry the load. Conversely, a load-only distribution can leave small local minima or overhang fragments uncovered.

A useful per-component estimate is therefore:

```text
required support count = max(
  mandatory topology seeds,
  coverage estimate,
  capacity estimate
)
```

Capacity should eventually include inexpensive proxies for:

- Current and downstream cross-sectional area.
- Rapid positive changes in layer area.
- Support height and shaft slenderness.
- Distance from the load centroid to the support polygon.
- Contact and shaft diameter.
- Cups, cavities, and trapped-resin risks.

Full finite-element separation simulation is not necessary for the first useful implementation.

## Proposed TinySlicer model

Keep two physical parameters separate:

```text
selfSupportGrowthMm  // permitted lateral growth inherited from lower model layers
coverageRadiusMm     // maximum acceptable distance from risky material to a contact
```

For model mask `M[i]`, compare against a lower layer using the existing research formulation:

```text
supportable[i] = dilate(M[i - k], k * layerHeight / tan(overhangAngle))
unsupported[i] = M[i] - supportable[i]
```

Using several layers of lookback avoids rounding TinyMaker's 0.05 mm growth allowance to zero at its 0.1275 mm pixel pitch. Connected components in `unsupported[i]` are classified as:

- `island`: the complete current-layer component has no overlap with the supportable mask.
- `overhang`: some of the complete component is inherited, but a portion grows beyond the allowance.

For every retained unsupported component:

1. Keep at least one point for a new island, regardless of its area.
2. Choose an interior point with maximum distance from the component boundary.
3. Mark pixels within `coverageRadiusMm` as covered.
4. Repeat until the component is covered or a safety limit is reached.

This is a deterministic greedy disk-cover approximation. Candidate pixel centers must later be mapped to exact underside contacts on the transformed mesh. Routing, collision checks, mechanical reinforcement, and pruning remain separate passes.

## Implementation sequence

1. Implement binary-mask dilation, subtraction, component classification, and greedy contact coverage in physical units.
2. Add multi-layer analysis around the rolling layer-mask producer without retaining the complete uncompressed stack.
3. Track component ancestry and propagate contacts only upward through valid model connections.
4. Map candidate pixels to exact model contacts and preview them without creating supports.
5. Add cheap capacity and support-polygon reinforcement proxies.
6. Route valid posts, report unresolved candidates, and let the user add, remove, or move every suggestion.
7. Calibrate presets with physical coupons before treating any spacing as reliable.

## Calibration plan

TinyMaker should use printer-specific test coupons rather than copying another slicer's density:

- Horizontal plates at several thicknesses.
- Inclined plates around the configured overhang threshold.
- Sharp minima followed by small and large area growth.
- Several contact diameters and support heights.
- Several center spacings, for example 2, 3, 4, 5, and 6 mm.
- Repeated prints using fixed resin, exposure, temperature, and lift settings.

Record outright failures, visible deformation, dimensional error, and removal damage. The resulting preset can map part thickness, support size, and support height to conservative coverage and capacity values.

## Current implementation

`src/lib/supports/detect-unsupported.ts` implements the first sequence item. It accepts a current mask and a lower comparison mask, preserves the physical dilation radius as a floating-point value, labels islands and overhang growth, applies the physical-area threshold, and greedily produces deterministic disk-cover candidates. It also reports regions left incomplete by its per-region safety limit.

`src/lib/slicing/model-layer-masks.ts` now supplies the binary model masks. It uses TinyMaker's 320 × 240 build-area grid and 0.05 mm layer height by default, samples each pixel at its physical center, and applies exactly the model translation and quaternion rotation used by the viewport. Each vertical pixel ray stores oriented mesh crossings and fills non-zero winding intervals, preserving correctly oriented cavities and unioning overlapping closed solids. A requested layer is emitted lazily as 0 or 1 values, so analysis can keep only a rolling window rather than roughly 92 MB for a full 60 mm build.

This is deliberately a binary geometry pass. Edge coverage and grayscale anti-aliasing belong in final image generation, where subpixel sampling can be selected independently of support analysis. The winding method expects a closed, consistently oriented mesh. It ignores triangles parallel to the ray and reports pixels whose signed crossings do not balance so callers can warn about open or malformed STLs rather than silently treating them as reliable.

`src/lib/supports/generate-auto-supports.ts` connects the rolling masks to the detector and the existing editable post geometry. The initial conservative defaults use a three-layer lookback, a 45° growth limit, a 0.25 mm² overhang threshold, a 3 mm coverage radius, and a global limit of 256 supports. Repeated candidates are suppressed only in the upward direction; genuinely new islands keep their topology seed. Candidate pixels are mapped to their lower vertical mesh crossing and may terminate on sufficiently distant model geometry below. Open sampled meshes receive no automatic guesses.

Entering the Supports workflow step generates this initial set only when no supports exist, so revisiting the step cannot duplicate or overwrite manual work. The UI explicitly describes the result as suggestions requiring review. The current cheap contact mapper uses a downward normal and therefore creates vertical necks; exact triangle-normal recovery, collision-aware routing, mechanical capacity reinforcement, removal, and complete ancestry tracking remain future passes.

## Sources

- Lingxin Cao et al., [Auto-support: traction force constrained support structures optimization for bottom-up vat photopolymerization](https://www.tandfonline.com/doi/full/10.1080/17452759.2025.2466189), _Virtual and Physical Prototyping_, 2025.
- Seongje Jang, Byungjin Moon, and Kunwoo Lee, [Free-Floating Support Structure Generation](https://www.sciencedirect.com/science/article/abs/pii/S0010448520301019), _Computer-Aided Design_, 2020.
- Berker Alpöz, Burçin Akan, and Ender Akan, [Effect of Support Spacing on the Region-Specific Dimensional Accuracy of 3D-Printed Dental Models](https://www.mdpi.com/1996-1944/19/16/3463), _Materials_, 2026.
- Formlabs, [How supports work in SLA printing](https://formlabs.com/global/support/How-supports-work-in-SLA-printing/).
- Formlabs, [Design specifications for 3D models (Form 4 generation)](https://formlabs.com/support/Design-specifications-for-3D-models-Form-4-generation/).
