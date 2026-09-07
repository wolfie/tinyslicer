import { Quaternion, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';

import { TINYMAKER_PROFILE } from '$lib/printer/tinymaker';
import type { ImportedStlModel } from '../stl-importer';
import {
	findInBoundsZRotation,
	firstBuildVolumeOverflowDirection,
	IDENTITY_MODEL_ROTATION,
	isModelOutsideBuildVolume,
	nudgeModelTranslation,
	ROTATION_SNAP_DEGREES,
	signedRotationAngle,
	snapRotationAngle,
	transformModelBounds,
	transformModelGeometryBounds,
	transformModelPoint,
	translateModelBounds
} from './model-transform';

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
	it.each([
		[
			{ x: -0.01, y: 1, z: 1 },
			{ x: 1, y: 2, z: 2 },
			{ x: -1, y: 0, z: 0 }
		],
		[
			{ x: 1, y: 1, z: 1 },
			{ x: TINYMAKER_PROFILE.buildVolume.x + 0.01, y: 2, z: 2 },
			{ x: 1, y: 0, z: 0 }
		],
		[
			{ x: 1, y: -0.01, z: 1 },
			{ x: 2, y: 2, z: 2 },
			{ x: 0, y: -1, z: 0 }
		],
		[
			{ x: 1, y: 1, z: 1 },
			{ x: 2, y: TINYMAKER_PROFILE.buildVolume.y + 0.01, z: 2 },
			{ x: 0, y: 1, z: 0 }
		],
		[
			{ x: 1, y: 1, z: -0.01 },
			{ x: 2, y: 2, z: 2 },
			{ x: 0, y: 0, z: -1 }
		],
		[
			{ x: 1, y: 1, z: 1 },
			{ x: 2, y: 2, z: TINYMAKER_PROFILE.buildVolume.z + 0.01 },
			{ x: 0, y: 0, z: 1 }
		]
	])('finds the outward camera direction for an overflowing face', (min, max, expected) => {
		expect(firstBuildVolumeOverflowDirection({ min, max })).toEqual(expected);
	});

	it('keeps a stable face priority when the model overflows in multiple directions', () => {
		expect(
			firstBuildVolumeOverflowDirection({
				min: { x: -1, y: -1, z: -1 },
				max: {
					x: TINYMAKER_PROFILE.buildVolume.x + 1,
					y: TINYMAKER_PROFILE.buildVolume.y + 1,
					z: TINYMAKER_PROFILE.buildVolume.z + 1
				}
			})
		).toEqual({ x: -1, y: 0, z: 0 });
	});

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

	it('recomputes the axis-aligned bounds after rotating around the model center', () => {
		const quarterTurn = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), Math.PI / 2);
		const rotation = {
			x: quarterTurn.x,
			y: quarterTurn.y,
			z: quarterTurn.z,
			w: quarterTurn.w
		};

		const bounds = transformModelBounds(
			{ min: { x: 10, y: 8, z: 0 }, max: { x: 12, y: 14, z: 4 } },
			{ x: 3, y: -2, z: 1 },
			rotation
		);

		expect(bounds.min.x).toBeCloseTo(11);
		expect(bounds.max.x).toBeCloseTo(17);
		expect(bounds.min.y).toBeCloseTo(8);
		expect(bounds.max.y).toBeCloseTo(10);
		expect(bounds.min.z).toBeCloseTo(1);
		expect(bounds.max.z).toBeCloseTo(5);
	});

	it('scales uniformly while keeping the oriented bottom-center fixed', () => {
		const bounds = { min: { x: 10, y: 8, z: 0 }, max: { x: 14, y: 14, z: 6 } };
		const bottomCenter = { x: 12, y: 11, z: 0 };

		expect(transformModelBounds(bounds, undefined, undefined, 2)).toEqual({
			min: { x: 8, y: 5, z: 0 },
			max: { x: 16, y: 17, z: 12 }
		});
		expect(transformModelPoint(bottomCenter, bounds, undefined, undefined, 2).toArray()).toEqual([
			12, 11, 0
		]);
	});

	it('moves the center of rotation with the scale transformation', () => {
		const bounds = { min: { x: 10, y: 8, z: 0 }, max: { x: 14, y: 14, z: 6 } };
		const center = { x: 12, y: 11, z: 3 };
		const rotation = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), Math.PI / 4);

		const before = transformModelPoint(center, bounds, undefined, rotation, 1);
		const after = transformModelPoint(center, bounds, undefined, rotation, 3);
		const afterWithoutRotation = transformModelPoint(center, bounds, undefined, undefined, 3);

		expect(before.toArray()).toEqual([12, 11, 3]);
		expect(after.toArray()).toEqual([12, 11, 9]);
		expect(after.distanceTo(afterWithoutRotation)).toBeLessThan(1e-9);
	});

	it('uses the rotated bounds for build-volume feedback', () => {
		const model = modelWithBounds({ x: 1, y: 13, z: 0 }, { x: 39, y: 17, z: 4 });
		const quarterTurn = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), Math.PI / 2);

		expect(isModelOutsideBuildVolume(model, { x: 0, y: 0, z: 0 }, IDENTITY_MODEL_ROTATION)).toBe(
			false
		);
		expect(isModelOutsideBuildVolume(model, { x: 0, y: 0, z: 0 }, quarterTurn)).toBe(true);
	});

	it('uses mesh vertices instead of empty bounding-box corners after rotation', () => {
		const model = modelWithBounds({ x: -0.2, y: 10.3, z: 0 }, { x: 39.8, y: 20.3, z: 1 });
		model.positions = new Float32Array([
			-0.2, 10.3, 0, 39.8, 10.3, 0, -0.2, 20.3, 0, -0.2, 10.3, 1, 39.8, 10.3, 1, -0.2, 20.3, 1
		]);
		const eighthTurn = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), Math.PI / 4);
		const translation = { x: 0, y: 2.5, z: 0 };

		expect(isModelOutsideBuildVolume(model)).toBe(true);
		expect(transformModelBounds(model.bounds, translation, eighthTurn).max.y).toBeGreaterThan(
			TINYMAKER_PROFILE.buildVolume.y
		);
		expect(transformModelGeometryBounds(model, translation, eighthTurn).max.y).toBeLessThan(
			TINYMAKER_PROFILE.buildVolume.y
		);
		expect(isModelOutsideBuildVolume(model, translation, eighthTurn)).toBe(false);
	});

	it('ignores floating-point noise at a build-volume boundary', () => {
		const model = modelWithBounds(
			{ x: 0, y: 0, z: 0 },
			{ x: TINYMAKER_PROFILE.buildVolume.x, y: 10, z: 10 }
		);
		model.positions = new Float32Array([0, 0, 0, TINYMAKER_PROFILE.buildVolume.x, 0, 0, 0, 10, 10]);

		expect(isModelOutsideBuildVolume(model, { x: -Number.EPSILON, y: 0, z: 0 })).toBe(false);
	});
});

describe('initial in-bounds Z rotation search', () => {
	const buildCenter = {
		x: TINYMAKER_PROFILE.buildVolume.x / 2,
		y: TINYMAKER_PROFILE.buildVolume.y / 2
	};

	it('leaves a model that already fits unrotated', () => {
		const model = modelWithBounds({ x: 5, y: 5, z: 0 }, { x: 15, y: 15, z: 10 });

		expect(findInBoundsZRotation(model)).toEqual(IDENTITY_MODEL_ROTATION);
	});

	it('turns a bar that overflows lengthwise a quarter turn to fit', () => {
		// 35 mm long on Y (build depth is only 30.6 mm), 4 mm wide on X, centred.
		const model = modelWithBounds(
			{ x: buildCenter.x - 2, y: buildCenter.y - 17.5, z: 0 },
			{ x: buildCenter.x + 2, y: buildCenter.y + 17.5, z: 4 }
		);
		expect(isModelOutsideBuildVolume(model)).toBe(true);

		const rotation = findInBoundsZRotation(model);

		expect(rotation.x).toBeCloseTo(0);
		expect(rotation.y).toBeCloseTo(0);
		expect(Math.abs(rotation.z)).toBeCloseTo(Math.SQRT1_2);
		expect(rotation.w).toBeCloseTo(Math.SQRT1_2);
		expect(isModelOutsideBuildVolume(model, undefined, rotation)).toBe(false);
	});

	it('gives up with the identity rotation when the model is simply too tall', () => {
		const model = modelWithBounds(
			{ x: buildCenter.x - 2, y: buildCenter.y - 2, z: 0 },
			{ x: buildCenter.x + 2, y: buildCenter.y + 2, z: TINYMAKER_PROFILE.buildVolume.z + 5 }
		);

		expect(findInBoundsZRotation(model)).toEqual(IDENTITY_MODEL_ROTATION);
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

describe('model rotation snapping', () => {
	it(`snaps to ${ROTATION_SNAP_DEGREES} degree increments by default`, () => {
		const degrees = (value: number) => (value * Math.PI) / 180;

		expect(snapRotationAngle(degrees(10))).toBeCloseTo(0);
		expect(snapRotationAngle(degrees(12))).toBeCloseTo(degrees(ROTATION_SNAP_DEGREES));
		expect(snapRotationAngle(degrees(-34))).toBeCloseTo(degrees(-2 * ROTATION_SNAP_DEGREES));
	});

	it('leaves the angle untouched while free rotation is enabled', () => {
		const angle = Math.PI / 7;
		expect(snapRotationAngle(angle, true)).toBe(angle);
	});
});

describe('physical rotation dragging', () => {
	const axis = new Vector3(0, 1, 0);

	it('maps opposite points on a ring to a 180 degree rotation', () => {
		const angle = signedRotationAngle(new Vector3(1, 0, 0), new Vector3(-1, 0, 0), axis);

		expect(Math.abs(angle)).toBeCloseTo(Math.PI);
	});

	it('tracks the signed angle between successive grab points', () => {
		const firstQuarter = signedRotationAngle(new Vector3(1, 0, 0), new Vector3(0, 0, -1), axis);
		const secondQuarter = signedRotationAngle(new Vector3(0, 0, -1), new Vector3(-1, 0, 0), axis);

		expect(firstQuarter).toBeCloseTo(Math.PI / 2);
		expect(secondQuarter).toBeCloseTo(Math.PI / 2);
		expect(firstQuarter + secondQuarter).toBeCloseTo(Math.PI);
	});
});
