import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';

import { TINYMAKER_PROFILE } from '$lib/printer/tinymaker';
import type { ImportedStlModel } from './stl-importer';
import {
	createBuildVolumeClippingPlanes,
	createMillimetreRulerVertices,
	isModelOutsideBuildVolume,
	nudgeModelTranslation,
	translateModelBounds
} from './build-volume-renderer';

function segmentAt(vertices: number[], index: number): [Vector3, Vector3] {
	const offset = index * 6;
	return [
		new Vector3(vertices[offset], vertices[offset + 1], vertices[offset + 2]),
		new Vector3(vertices[offset + 3], vertices[offset + 4], vertices[offset + 5])
	];
}

describe('millimetre rulers', () => {
	const vertices = createMillimetreRulerVertices(
		new Vector3(0, 0, 0),
		new Vector3(1, 0, 0),
		new Vector3(0, 1, 0),
		22
	);

	it('draws a baseline for the full axis length and ticks every 5 millimetres', () => {
		const [baselineStart, baselineEnd] = segmentAt(vertices, 0);
		expect(baselineStart).toEqual(new Vector3(0, 0.8, 0));
		expect(baselineEnd).toEqual(new Vector3(22, 0.8, 0));
		expect(vertices).toHaveLength(6 * 6);

		const tickPositions = Array.from(
			{ length: 5 },
			(_, index) => segmentAt(vertices, index + 1)[0].x
		);
		expect(tickPositions).toEqual([0, 5, 10, 15, 20]);
	});

	it('uses longer ticks at each 10 millimetre mark', () => {
		const tickLengths = Array.from({ length: 5 }, (_, index) => {
			const [start, end] = segmentAt(vertices, index + 1);
			return end.distanceTo(start);
		});

		for (const [index, expectedLength] of [1.2, 0.65, 1.2, 0.65, 1.2].entries()) {
			expect(tickLengths[index]).toBeCloseTo(expectedLength);
		}
	});

	it('normalizes directions so diagonal rulers keep consistent tick lengths', () => {
		const diagonalVertices = createMillimetreRulerVertices(
			new Vector3(0, 0, 0),
			new Vector3(0, 0, 2),
			new Vector3(-1, 1, 0),
			10
		);
		const [baselineStart, baselineEnd] = segmentAt(diagonalVertices, 0);
		const [tickStart, tickEnd] = segmentAt(diagonalVertices, 1);

		expect(baselineEnd.distanceTo(baselineStart)).toBeCloseTo(10);
		expect(tickEnd.distanceTo(tickStart)).toBeCloseTo(1.2);
	});
});

function isClipped(point: Vector3, region: 'inside' | 'outside'): boolean {
	const negativeDistances = createBuildVolumeClippingPlanes(region).map(
		(plane) => plane.distanceToPoint(point) < 0
	);
	return region === 'inside' ? negativeDistances.some(Boolean) : negativeDistances.every(Boolean);
}

describe('build volume model clipping', () => {
	it('keeps points inside the build volume in the blue pass only', () => {
		const { x, y, z } = TINYMAKER_PROFILE.buildVolume;
		const point = new Vector3(x / 2, y / 2, z / 2);

		expect(isClipped(point, 'inside')).toBe(false);
		expect(isClipped(point, 'outside')).toBe(true);
	});

	it.each([
		['left', new Vector3(-1, 1, 1)],
		['right', new Vector3(TINYMAKER_PROFILE.buildVolume.x + 1, 1, 1)],
		['front', new Vector3(1, -1, 1)],
		['back', new Vector3(1, TINYMAKER_PROFILE.buildVolume.y + 1, 1)],
		['below', new Vector3(1, 1, -1)],
		['above', new Vector3(1, 1, TINYMAKER_PROFILE.buildVolume.z + 1)]
	])('keeps points beyond the %s face in the yellow pass only', (_face, point) => {
		expect(isClipped(point, 'inside')).toBe(true);
		expect(isClipped(point, 'outside')).toBe(false);
	});
});

function modelWithBounds(
	min: ImportedStlModel['bounds']['min'],
	max: ImportedStlModel['bounds']['max']
): ImportedStlModel {
	return {
		name: 'model.stl',
		format: 'ASCII',
		positions: new Float32Array(),
		normals: new Float32Array(),
		bounds: { min, max },
		dimensions: { x: max.x - min.x, y: max.y - min.y, z: max.z - min.z },
		triangleCount: 0,
		byteLength: 0
	};
}

describe('build volume fit', () => {
	it('accepts a model touching every build volume boundary', () => {
		const { x, y, z } = TINYMAKER_PROFILE.buildVolume;
		const model = modelWithBounds({ x: 0, y: 0, z: 0 }, { x, y, z });

		expect(isModelOutsideBuildVolume(model)).toBe(false);
	});

	it.each([
		[
			{ x: -0.01, y: 0, z: 0 },
			{ x: 1, y: 1, z: 1 }
		],
		[
			{ x: 0, y: 0, z: 0 },
			{ x: TINYMAKER_PROFILE.buildVolume.x + 0.01, y: 1, z: 1 }
		],
		[
			{ x: 0, y: -0.01, z: 0 },
			{ x: 1, y: 1, z: 1 }
		],
		[
			{ x: 0, y: 0, z: 0 },
			{ x: 1, y: TINYMAKER_PROFILE.buildVolume.y + 0.01, z: 1 }
		],
		[
			{ x: 0, y: 0, z: -0.01 },
			{ x: 1, y: 1, z: 1 }
		],
		[
			{ x: 0, y: 0, z: 0 },
			{ x: 1, y: 1, z: TINYMAKER_PROFILE.buildVolume.z + 0.01 }
		]
	])('rejects a model extending beyond a build volume face', (min, max) => {
		expect(isModelOutsideBuildVolume(modelWithBounds(min, max))).toBe(true);
	});

	it('re-evaluates translated bounds against every build volume face', () => {
		const model = modelWithBounds({ x: 10, y: 10, z: 0 }, { x: 20, y: 20, z: 10 });

		expect(isModelOutsideBuildVolume(model, { x: -10, y: -10, z: 0 })).toBe(false);
		expect(isModelOutsideBuildVolume(model, { x: -10.01, y: 0, z: 0 })).toBe(true);
		expect(
			isModelOutsideBuildVolume(model, {
				x: TINYMAKER_PROFILE.buildVolume.x - 19.99,
				y: 0,
				z: 0
			})
		).toBe(true);
		expect(isModelOutsideBuildVolume(model, { x: 0, y: -10.01, z: 0 })).toBe(true);
		expect(
			isModelOutsideBuildVolume(model, {
				x: 0,
				y: TINYMAKER_PROFILE.buildVolume.y - 19.99,
				z: 0
			})
		).toBe(true);
		expect(isModelOutsideBuildVolume(model, { x: 0, y: 0, z: -0.01 })).toBe(true);
		expect(
			isModelOutsideBuildVolume(model, {
				x: 0,
				y: 0,
				z: TINYMAKER_PROFILE.buildVolume.z - 9.99
			})
		).toBe(true);
	});

	it('translates min and max bounds without mutating the imported model', () => {
		const model = modelWithBounds({ x: 4, y: 5, z: 6 }, { x: 14, y: 15, z: 16 });

		expect(translateModelBounds(model.bounds, { x: 2, y: -3, z: 5 })).toEqual({
			min: { x: 6, y: 2, z: 11 },
			max: { x: 16, y: 12, z: 21 }
		});
		expect(model.bounds).toEqual({
			min: { x: 4, y: 5, z: 6 },
			max: { x: 14, y: 15, z: 16 }
		});
	});
});

describe('model translation nudges', () => {
	it('moves one millimetre normally and five millimetres with the large step', () => {
		const origin = { x: 2, y: 3, z: 4 };

		expect(nudgeModelTranslation(origin, 'x', -1)).toEqual({ x: 1, y: 3, z: 4 });
		expect(nudgeModelTranslation(origin, 'y', 1, true)).toEqual({ x: 2, y: 8, z: 4 });
		expect(nudgeModelTranslation(origin, 'z', -1, true)).toEqual({ x: 2, y: 3, z: -1 });
		expect(origin).toEqual({ x: 2, y: 3, z: 4 });
	});
});
