import { describe, expect, it } from 'vitest';

import type { Bounds3 } from '$lib/workspace/stl-importer';
import {
	ModelLayerMaskRasterizer,
	TINYMAKER_LAYER_MASK_PROFILE,
	type LayerMaskRasterizationProfile
} from './model-layer-masks';

const FOUR_BY_FOUR_PROFILE: LayerMaskRasterizationProfile = {
	resolution: { x: 4, y: 4 },
	buildAreaMm: { x: 4, y: 4 },
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
	const triangles: Point[][] = [
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
	];
	return triangles.flat(2);
}

function reverseWinding(positions: readonly number[]): number[] {
	const reversed: number[] = [];
	for (let offset = 0; offset < positions.length; offset += 9) {
		reversed.push(
			...positions.slice(offset, offset + 3),
			...positions.slice(offset + 6, offset + 9),
			...positions.slice(offset + 3, offset + 6)
		);
	}
	return reversed;
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

function modelFromPositions(positionValues: readonly number[]) {
	const positions = Float32Array.from(positionValues);
	return { positions, bounds: boundsFor(positions) };
}

function rows(data: Uint8Array, width: number): string[] {
	const result: string[] = [];
	for (let offset = 0; offset < data.length; offset += width) {
		result.push(
			Array.from(data.slice(offset, offset + width), (value) => (value === 0 ? '.' : '#')).join('')
		);
	}
	return result;
}

describe('ModelLayerMaskRasterizer', () => {
	it('samples a closed solid at pixel centers into binary masks', () => {
		const rasterizer = new ModelLayerMaskRasterizer(
			modelFromPositions(boxPositions([1, 1, 0], [3, 3, 1])),
			undefined,
			undefined,
			FOUR_BY_FOUR_PROFILE
		);

		expect(rasterizer.layerCount).toBe(2);
		expect(rasterizer.layerZMm(0)).toBe(0.5);
		expect(rows(rasterizer.createLayerMask(0).data, 4)).toEqual(['....', '.##.', '.##.', '....']);
		expect(rows(rasterizer.createLayerMask(1).data, 4)).toEqual(['....', '.##.', '.##.', '....']);
		expect(rasterizer.diagnostics.oddIntersectionPixelCount).toBe(0);
	});

	it('uses the same model translation as the viewport', () => {
		const rasterizer = new ModelLayerMaskRasterizer(
			modelFromPositions(boxPositions([0, 1, 0], [2, 3, 0.5])),
			{ x: 1, y: 0, z: 0 },
			undefined,
			FOUR_BY_FOUR_PROFILE
		);

		expect(rows(rasterizer.createLayerMask(0).data, 4)).toEqual(['....', '.##.', '.##.', '....']);
		expect(rasterizer.transformedBounds.min.x).toBe(1);
		expect(rasterizer.transformedBounds.max.x).toBe(3);
	});

	it('uses the same bottom-center scale as the viewport', () => {
		const rasterizer = new ModelLayerMaskRasterizer(
			modelFromPositions(boxPositions([1.5, 1.5, 0], [2.5, 2.5, 1])),
			undefined,
			undefined,
			FOUR_BY_FOUR_PROFILE,
			2
		);

		expect(rasterizer.layerCount).toBe(4);
		expect(rasterizer.transformedBounds).toEqual({
			min: { x: 1, y: 1, z: 0 },
			max: { x: 3, y: 3, z: 2 }
		});
		expect(rows(rasterizer.createLayerMask(3).data, 4)).toEqual(['....', '.##.', '.##.', '....']);
	});

	it('uses the same quaternion rotation about the model center as the viewport', () => {
		const halfTurn = Math.PI / 4;
		const rasterizer = new ModelLayerMaskRasterizer(
			modelFromPositions(boxPositions([0, 1, 0], [4, 3, 0.5])),
			undefined,
			{ x: 0, y: 0, z: Math.sin(halfTurn), w: Math.cos(halfTurn) },
			FOUR_BY_FOUR_PROFILE
		);

		expect(rows(rasterizer.createLayerMask(0).data, 4)).toEqual(['.##.', '.##.', '.##.', '.##.']);
		expect(rasterizer.diagnostics.oddIntersectionPixelCount).toBe(0);
	});

	it('pairs multiple depth intervals along a pixel ray', () => {
		const positions = [
			...boxPositions([1, 1, 0], [3, 3, 0.5]),
			...boxPositions([1, 1, 1], [3, 3, 1.5])
		];
		const rasterizer = new ModelLayerMaskRasterizer(
			modelFromPositions(positions),
			undefined,
			undefined,
			{ ...FOUR_BY_FOUR_PROFILE, layerHeightMm: 0.25 }
		);

		expect(rasterizer.layerCount).toBe(6);
		expect(Array.from(rasterizer.masks(), (mask) => mask.data[5])).toEqual([1, 1, 0, 1, 1, 1]);
		expect(rasterizer.verticalIntervalsAtPixel(1, 1)).toEqual([
			{ minimumZMm: 0, maximumZMm: 0.5 },
			{ minimumZMm: 1, maximumZMm: 1.5 }
		]);
	});

	it('preserves parity where two closed solids touch', () => {
		const positions = [
			...boxPositions([1, 1, 0], [3, 3, 0.5]),
			...boxPositions([1, 1, 0.5], [3, 3, 1])
		];
		const rasterizer = new ModelLayerMaskRasterizer(
			modelFromPositions(positions),
			undefined,
			undefined,
			{ ...FOUR_BY_FOUR_PROFILE, layerHeightMm: 0.25 }
		);

		expect(Array.from(rasterizer.masks(), (mask) => mask.data[5])).toEqual([1, 1, 1, 1]);
		expect(rasterizer.diagnostics.oddIntersectionPixelCount).toBe(0);
	});

	it('unions overlapping closed solids instead of cancelling their overlap', () => {
		const positions = [
			...boxPositions([0, 1, 0], [3, 3, 1]),
			...boxPositions([1, 1, 0], [4, 3, 1])
		];
		const rasterizer = new ModelLayerMaskRasterizer(
			modelFromPositions(positions),
			undefined,
			undefined,
			FOUR_BY_FOUR_PROFILE
		);

		expect(rows(rasterizer.createLayerMask(0).data, 4)).toEqual(['....', '####', '####', '....']);
		expect(rasterizer.verticalIntervalsAtPixel(1, 1)).toEqual([{ minimumZMm: 0, maximumZMm: 1 }]);
		expect(rasterizer.diagnostics.oddIntersectionPixelCount).toBe(0);
	});

	it('preserves a correctly oriented enclosed cavity', () => {
		const positions = [
			...boxPositions([0, 0, 0], [4, 4, 2]),
			...reverseWinding(boxPositions([1, 1, 0.5], [3, 3, 1.5]))
		];
		const rasterizer = new ModelLayerMaskRasterizer(
			modelFromPositions(positions),
			undefined,
			undefined,
			FOUR_BY_FOUR_PROFILE
		);

		expect(rows(rasterizer.createLayerMask(1).data, 4)).toEqual(['####', '#..#', '#..#', '####']);
		expect(rasterizer.verticalIntervalsAtPixel(1, 1)).toEqual([
			{ minimumZMm: 0, maximumZMm: 0.5 },
			{ minimumZMm: 1.5, maximumZMm: 2 }
		]);
	});

	it('reports odd crossings from an open mesh and ignores an unpaired crossing', () => {
		const rasterizer = new ModelLayerMaskRasterizer(
			modelFromPositions([1, 1, 0.5, 3, 1, 0.5, 1, 3, 0.5]),
			undefined,
			undefined,
			FOUR_BY_FOUR_PROFILE
		);

		expect(rasterizer.diagnostics.oddIntersectionPixelCount).toBeGreaterThan(0);
		expect(rasterizer.createLayerMask(0).data.every((value) => value === 0)).toBe(true);
	});

	it('rejects layer indices outside the generated stack', () => {
		const rasterizer = new ModelLayerMaskRasterizer(
			modelFromPositions(boxPositions([1, 1, 0], [3, 3, 0.5])),
			undefined,
			undefined,
			FOUR_BY_FOUR_PROFILE
		);

		expect(() => rasterizer.createLayerMask(-1)).toThrow(/layerIndex/);
		expect(() => rasterizer.createLayerMask(1)).toThrow(/layerIndex/);
	});

	it('defines the requested TinyMaker sampling grid', () => {
		expect(TINYMAKER_LAYER_MASK_PROFILE).toEqual({
			resolution: { x: 320, y: 240 },
			buildAreaMm: { x: 40.8, y: 30.6 },
			layerHeightMm: 0.05
		});

		const rasterizer = new ModelLayerMaskRasterizer(
			modelFromPositions(boxPositions([0, 0, 0], [40.8, 30.6, 0.05]))
		);
		const mask = rasterizer.createLayerMask(0);
		expect(rasterizer.layerCount).toBe(1);
		expect(mask).toMatchObject({ width: 320, height: 240 });
		expect(mask.data.every((value) => value === 1)).toBe(true);
	});
});
