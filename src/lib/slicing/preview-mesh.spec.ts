import { describe, expect, it } from 'vitest';

import type { Bounds3 } from '$lib/workspace/stl-importer';
import type { SupportPlan } from '$lib/workspace/supports';
import type { LayerMaskRasterizationProfile } from './model-layer-masks';
import { buildPreviewMesh, type PreviewMeshInput } from './preview-mesh';

const PROFILE: LayerMaskRasterizationProfile = {
	resolution: { x: 16, y: 16 },
	buildAreaMm: { x: 16, y: 16 },
	layerHeightMm: 0.5
};
const OPTIONS = { profile: PROFILE, supersample: 2 } as const;
const NO_SUPPORTS: SupportPlan = { structures: [], unresolvedPoints: [] };

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

function meshInput(values: number[], supportPlan: SupportPlan = NO_SUPPORTS): PreviewMeshInput {
	const positions = Float32Array.from(values);
	return {
		model: { positions, bounds: boundsFor(positions) },
		translation: { x: 0, y: 0, z: 0 },
		rotation: { x: 0, y: 0, z: 0, w: 1 },
		supportPlan
	};
}

/** Counts flat horizontal triangles at height `zMm` whose normal points up (+1) or down (-1). */
function horizontalCapCount(
	positions: Float32Array,
	normals: Float32Array,
	zMm: number,
	direction: 1 | -1
): number {
	let count = 0;
	for (let i = 0; i < positions.length; i += 9) {
		const flat =
			Math.abs(positions[i + 2] - zMm) < 1e-4 &&
			Math.abs(positions[i + 5] - zMm) < 1e-4 &&
			Math.abs(positions[i + 8] - zMm) < 1e-4;
		if (flat && Math.sign(normals[i + 2]) === direction && Math.abs(normals[i + 2]) > 0.9)
			count += 1;
	}
	return count;
}

/** Total triangle area whose normal points up (+1) or down (-1). A closed surface
 *  projects the same area onto the plate from above and below. */
function directedHorizontalArea(positions: Float32Array, normals: Float32Array, direction: 1 | -1) {
	let area = 0;
	for (let i = 0; i < positions.length; i += 9) {
		if (Math.sign(normals[i + 2]) !== direction || Math.abs(normals[i + 2]) < 0.9) continue;
		area +=
			Math.abs(
				(positions[i + 3] - positions[i]) * (positions[i + 7] - positions[i + 1]) -
					(positions[i + 4] - positions[i + 1]) * (positions[i + 6] - positions[i])
			) / 2;
	}
	return area;
}

function duplicateTriangleCount(positions: Float32Array): number {
	const seen = new Map<string, number>();
	let duplicates = 0;
	for (let i = 0; i < positions.length; i += 9) {
		const corners = [
			`${Math.round(positions[i] * 1e3)},${Math.round(positions[i + 1] * 1e3)},${Math.round(positions[i + 2] * 1e3)}`,
			`${Math.round(positions[i + 3] * 1e3)},${Math.round(positions[i + 4] * 1e3)},${Math.round(positions[i + 5] * 1e3)}`,
			`${Math.round(positions[i + 6] * 1e3)},${Math.round(positions[i + 7] * 1e3)},${Math.round(positions[i + 8] * 1e3)}`
		]
			.sort()
			.join('|');
		seen.set(corners, (seen.get(corners) ?? 0) + 1);
		if ((seen.get(corners) ?? 0) > 1) duplicates += 1;
	}
	return duplicates;
}

function meshBounds(positions: Float32Array) {
	const min = { x: Infinity, y: Infinity, z: Infinity };
	const max = { x: -Infinity, y: -Infinity, z: -Infinity };
	for (let i = 0; i < positions.length; i += 3) {
		min.x = Math.min(min.x, positions[i]);
		min.y = Math.min(min.y, positions[i + 1]);
		min.z = Math.min(min.z, positions[i + 2]);
		max.x = Math.max(max.x, positions[i]);
		max.y = Math.max(max.y, positions[i + 1]);
		max.z = Math.max(max.z, positions[i + 2]);
	}
	return { min, max };
}

describe('buildPreviewMesh', () => {
	it('extrudes a solid box into a closed-looking mesh matching its footprint and height', () => {
		const result = buildPreviewMesh(
			meshInput(boxPositions([4, 4, 0], [12, 12, 3])),
			undefined,
			OPTIONS
		);

		expect(result.layerCount).toBe(6);
		expect(result.zHeightMm).toBe(3);
		expect(result.triangleCount).toBeGreaterThan(0);
		expect(result.meshIsWatertightAtPixelSamples).toBe(true);
		expect(result.normals.length).toBe(result.positions.length);
		expect(result.layerPixels).toHaveLength(PROFILE.resolution.x * PROFILE.resolution.y * 6);
		expect(result.volumeCubicMm).toBeCloseTo(8 * 8 * 3, 5);

		const bounds = meshBounds(result.positions);
		expect(bounds.min.z).toBeCloseTo(0, 5);
		expect(bounds.max.z).toBeCloseTo(3, 5);
		expect(bounds.min.x).toBeGreaterThan(3);
		expect(bounds.min.x).toBeLessThan(5);
		expect(bounds.max.x).toBeGreaterThan(11);
		expect(bounds.max.x).toBeLessThan(13);

		// A closed box needs a down-facing plate cap and an up-facing top cap.
		expect(horizontalCapCount(result.positions, result.normals, 0, -1)).toBeGreaterThan(0);
		expect(horizontalCapCount(result.positions, result.normals, 3, 1)).toBeGreaterThan(0);
		expect(horizontalCapCount(result.positions, result.normals, 0, 1)).toBe(0);
	});

	it('builds a closed, non-overlapping surface for a tapered shape', () => {
		// Square pyramid: contour shrinks every layer, top and bottom caps plus
		// a stack of ring ledges.
		const half = 11;
		const apex: Point = [24, 24, 6];
		const base: Point[] = [
			[24 - half, 24 - half, 0],
			[24 + half, 24 - half, 0],
			[24 + half, 24 + half, 0],
			[24 - half, 24 + half, 0]
		];
		const tris = [
			[base[0], base[2], base[1]],
			[base[0], base[3], base[2]],
			...base.map((corner, index) => [corner, base[(index + 1) % 4], apex])
		].flat(2);

		const result = buildPreviewMesh(
			{
				model: { positions: Float32Array.from(tris), bounds: boundsFor(Float32Array.from(tris)) },
				translation: { x: 0, y: 0, z: 0 },
				rotation: { x: 0, y: 0, z: 0, w: 1 },
				supportPlan: NO_SUPPORTS
			},
			undefined,
			{
				profile: {
					resolution: { x: 48, y: 48 },
					buildAreaMm: { x: 48, y: 48 },
					layerHeightMm: 0.5
				},
				supersample: 4
			}
		);

		expect(result.triangleCount).toBeGreaterThan(0);
		expect(duplicateTriangleCount(result.positions)).toBe(0);
		const up = directedHorizontalArea(result.positions, result.normals, 1);
		const down = directedHorizontalArea(result.positions, result.normals, -1);
		expect(down).toBeGreaterThan(0);
		expect(up).toBeCloseTo(down, 1); // closed volume: equal projected area top and bottom
	});

	it('caps the exposed ledges of a stepped shape, facing the right way', () => {
		// Two stacked boxes: a wide base to z = 1, a narrower tower to z = 2.
		const result = buildPreviewMesh(
			meshInput([...boxPositions([3, 3, 0], [13, 13, 1]), ...boxPositions([6, 6, 1], [10, 10, 2])]),
			undefined,
			OPTIONS
		);

		// Up-facing ledge where the base is exposed around the tower (near z = 1)…
		const ledge =
			horizontalCapCount(result.positions, result.normals, 1, 1) +
			horizontalCapCount(result.positions, result.normals, 0.5, 1);
		expect(ledge).toBeGreaterThan(0);
		// …plus the tower top and the plate bottom.
		expect(horizontalCapCount(result.positions, result.normals, 2, 1)).toBeGreaterThan(0);
		expect(horizontalCapCount(result.positions, result.normals, 0, -1)).toBeGreaterThan(0);
	});

	it('unions overlapping model shells in the voxel preview', () => {
		const result = buildPreviewMesh(
			meshInput([...boxPositions([3, 4, 0], [10, 12, 1]), ...boxPositions([8, 4, 0], [13, 12, 1])]),
			undefined,
			OPTIONS
		);

		// The two footprints overlap by 2 × 8 mm. Their Boolean union is
		// 10 × 8 mm; parity/XOR would incorrectly leave only 64 mm².
		expect(directedHorizontalArea(result.positions, result.normals, -1)).toBeCloseTo(80, 5);
	});

	it('fuses supports into the same mesh, reaching down to the plate under a floating model', () => {
		const floating = boxPositions([5, 5, 4], [11, 11, 7]);

		const withoutSupports = buildPreviewMesh(meshInput(floating), undefined, OPTIONS);
		expect(meshBounds(withoutSupports.positions).min.z).toBeGreaterThan(3);

		const plan: SupportPlan = {
			structures: [
				{
					id: 'post:support-point-1',
					pointIds: ['support-point-1'],
					parts: [
						{
							kind: 'foot',
							start: { x: 8, y: 8, z: 0 },
							end: { x: 8, y: 8, z: 0.5 },
							startDiameter: 3,
							endDiameter: 1.6
						},
						{
							kind: 'shaft',
							start: { x: 8, y: 8, z: 0.5 },
							end: { x: 8, y: 8, z: 4 },
							startDiameter: 1.6,
							endDiameter: 1.6
						}
					]
				}
			],
			unresolvedPoints: []
		};
		const withSupports = buildPreviewMesh(meshInput(floating, plan), undefined, OPTIONS);

		expect(meshBounds(withSupports.positions).min.z).toBeLessThan(0.6);
		expect(withSupports.triangleCount).toBeGreaterThan(withoutSupports.triangleCount);
	});

	it('still returns a mesh result for a non-watertight mesh, flagged as such', () => {
		const result = buildPreviewMesh(meshInput([2, 2, 1, 12, 2, 1, 2, 12, 1]), undefined, OPTIONS);

		expect(result.meshIsWatertightAtPixelSamples).toBe(false);
		expect(result.triangleCount).toBe(0);
	});

	it('reports monotonic progress that finishes at the layer count', () => {
		const calls: Array<[number, number]> = [];
		const result = buildPreviewMesh(
			meshInput(boxPositions([4, 4, 0], [12, 12, 2])),
			(completed, total) => calls.push([completed, total]),
			OPTIONS
		);

		expect(calls.length).toBeGreaterThan(0);
		expect(calls.at(-1)).toEqual([result.layerCount, result.layerCount]);
		for (let i = 1; i < calls.length; i += 1)
			expect(calls[i][0]).toBeGreaterThanOrEqual(calls[i - 1][0]);
	});

	it('produces an empty result when the scene has no printable layers', () => {
		const calls: Array<[number, number]> = [];
		const result = buildPreviewMesh(
			meshInput(boxPositions([4, 4, 0], [12, 12, 0])),
			(completed, total) => calls.push([completed, total]),
			OPTIONS
		);

		expect(result).toMatchObject({ layerCount: 0, triangleCount: 0, zHeightMm: 0 });
		expect(result.positions.length).toBe(0);
		expect(calls).toEqual([[0, 0]]);
	});
});
