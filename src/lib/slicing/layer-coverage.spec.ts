import { describe, expect, it } from 'vitest';

import type { Bounds3 } from '$lib/workspace/stl-importer';
import type { SupportPlan } from '$lib/workspace/supports';
import { LayerCoverageRasterizer, PREVIEW_SUPERSAMPLE } from './layer-coverage';
import { ModelLayerMaskRasterizer, type LayerMaskRasterizationProfile } from './model-layer-masks';

const PROFILE: LayerMaskRasterizationProfile = {
	resolution: { x: 8, y: 8 },
	buildAreaMm: { x: 8, y: 8 },
	layerHeightMm: 0.5
};

type Point = [number, number, number];

function boxPositions(minimum: Point, maximum: Point): number[] {
	const [minX, minY, minZ] = minimum;
	const [maxX, maxY, maxZ] = maximum;
	const p000: Point = [minX, minY, minZ];
	const p100: Point = [maxX, minY, minZ];
	const p010: Point = [minX, maxY, minZ];
	const p110: Point = [maxX, maxY, minZ];
	const p001: Point = [minX, minY, maxZ];
	const p101: Point = [maxX, minY, maxZ];
	const p011: Point = [minX, maxY, maxZ];
	const p111: Point = [maxX, maxY, maxZ];
	return (
		[
			[p000, p010, p110],
			[p000, p110, p100],
			[p001, p101, p111],
			[p001, p111, p011],
			[p000, p100, p101],
			[p000, p101, p001],
			[p010, p011, p111],
			[p010, p111, p110],
			[p000, p001, p011],
			[p000, p011, p010],
			[p100, p110, p111],
			[p100, p111, p101]
		] as Point[][]
	).flat(2);
}

function boundsFor(positions: Float32Array): Bounds3 {
	const bounds: Bounds3 = {
		min: { x: Infinity, y: Infinity, z: Infinity },
		max: { x: -Infinity, y: -Infinity, z: -Infinity }
	};
	for (let offset = 0; offset < positions.length; offset += 3) {
		bounds.min.x = Math.min(bounds.min.x, positions[offset]);
		bounds.min.y = Math.min(bounds.min.y, positions[offset + 1]);
		bounds.min.z = Math.min(bounds.min.z, positions[offset + 2]);
		bounds.max.x = Math.max(bounds.max.x, positions[offset]);
		bounds.max.y = Math.max(bounds.max.y, positions[offset + 1]);
		bounds.max.z = Math.max(bounds.max.z, positions[offset + 2]);
	}
	return bounds;
}

function model(values: number[]) {
	const positions = Float32Array.from(values);
	return { positions, bounds: boundsFor(positions) };
}

const NO_SUPPORTS: SupportPlan = { structures: [], unresolvedPoints: [] };

describe('LayerCoverageRasterizer', () => {
	it('gives full coverage inside a solid, zero outside, and a fraction on the contour', () => {
		const rasterizer = new LayerCoverageRasterizer(
			model(boxPositions([2, 2, 0], [5.5, 5.5, 1])),
			undefined,
			undefined,
			NO_SUPPORTS,
			PROFILE
		);
		const mask = rasterizer.coverageMask(0);

		expect(mask).toMatchObject({ width: 8, height: 8 });
		expect(mask.data[3 * 8 + 3]).toBe(1);
		expect(mask.data[0]).toBe(0);
		const contactValue = mask.data[5 * 8 + 5];
		expect(contactValue).toBeGreaterThan(0);
		expect(contactValue).toBeLessThan(1);
	});

	it('quantizes coverage to supersample^2 + 1 levels', () => {
		const rasterizer = new LayerCoverageRasterizer(
			model(boxPositions([1.4, 1.4, 0], [6.1, 6.1, 1])),
			undefined,
			undefined,
			NO_SUPPORTS,
			PROFILE
		);
		const step = 1 / (PREVIEW_SUPERSAMPLE * PREVIEW_SUPERSAMPLE);
		for (const value of rasterizer.coverageMask(0).data) {
			expect(Math.abs(value / step - Math.round(value / step))).toBeLessThan(1e-6);
		}
	});

	it('composites support discs into the coverage away from the model', () => {
		const box = model(boxPositions([1, 1, 0], [3, 3, 2]));
		const plan: SupportPlan = {
			structures: [
				{
					id: 'post:support-point-1',
					pointIds: ['support-point-1'],
					parts: [
						{
							kind: 'shaft',
							start: { x: 6.5, y: 6.5, z: 0 },
							end: { x: 6.5, y: 6.5, z: 2 },
							startDiameter: 2,
							endDiameter: 2
						}
					]
				}
			],
			unresolvedPoints: []
		};

		const withoutSupports = new LayerCoverageRasterizer(
			box,
			undefined,
			undefined,
			NO_SUPPORTS,
			PROFILE
		).coverageMask(0);
		const withSupports = new LayerCoverageRasterizer(
			box,
			undefined,
			undefined,
			plan,
			PROFILE
		).coverageMask(0);

		const shaftPixel = 6 * 8 + 6;
		expect(withoutSupports.data[shaftPixel]).toBe(0);
		expect(withSupports.data[shaftPixel]).toBe(1);
	});

	it('enumerates layers exactly like the underlying mask rasterizer', () => {
		const positions = boxPositions([2, 2, 0], [5, 5, 1.35]);
		const coverage = new LayerCoverageRasterizer(
			model(positions),
			undefined,
			undefined,
			NO_SUPPORTS,
			PROFILE
		);
		const binary = new ModelLayerMaskRasterizer(model(positions), undefined, undefined, PROFILE);

		expect(coverage.layerCount).toBe(binary.layerCount);
		for (let i = 0; i < coverage.layerCount; i += 1) {
			expect(coverage.layerZMm(i)).toBe(binary.layerZMm(i));
		}
	});

	it('reports whether the sampled mesh was watertight', () => {
		const closed = new LayerCoverageRasterizer(
			model(boxPositions([2, 2, 0], [5, 5, 1])),
			undefined,
			undefined,
			NO_SUPPORTS,
			PROFILE
		);
		expect(closed.diagnostics.meshIsWatertightAtPixelSamples).toBe(true);

		const open = new LayerCoverageRasterizer(
			model([2, 2, 0.5, 5, 2, 0.5, 2, 5, 0.5]),
			undefined,
			undefined,
			NO_SUPPORTS,
			PROFILE
		);
		expect(open.diagnostics.meshIsWatertightAtPixelSamples).toBe(false);
	});

	it('rejects a non-integer supersample factor', () => {
		expect(
			() =>
				new LayerCoverageRasterizer(
					model(boxPositions([2, 2, 0], [5, 5, 1])),
					undefined,
					undefined,
					NO_SUPPORTS,
					PROFILE,
					1.5
				)
		).toThrow(/supersample/);
	});
});
