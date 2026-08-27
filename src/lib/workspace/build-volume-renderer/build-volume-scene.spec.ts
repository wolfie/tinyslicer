import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';

import { TINYMAKER_PROFILE } from '$lib/printer/tinymaker';
import {
	createBuildVolumeClippingPlanes,
	createMillimetreRulerVertices
} from './build-volume-scene';

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
