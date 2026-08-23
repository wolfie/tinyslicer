import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';

import { TINYMAKER_PROFILE } from '$lib/printer/tinymaker';
import type { ImportedStlModel } from './stl-importer';
import {
	createBuildVolumeClippingPlanes,
	isModelOutsideBuildVolume
} from './build-volume-renderer';

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
});
