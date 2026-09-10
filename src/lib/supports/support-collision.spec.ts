import { describe, expect, it } from 'vitest';

import {
	IDENTITY_MODEL_ROTATION,
	ZERO_MODEL_TRANSLATION
} from '$lib/workspace/build-volume-renderer/model-transform';
import {
	triangleIntersectsVerticalCylinder,
	VerticalModelCollisionIndex
} from './support-collision';

const CYLINDER = {
	x: 0,
	y: 0,
	minimumZMm: 1,
	maximumZMm: 9,
	radiusMm: 0.6375
};

describe('vertical support-cylinder collisions', () => {
	it('detects a vertical model wall inside the shaft radius', () => {
		expect(
			triangleIntersectsVerticalCylinder(
				{ x: 0.5, y: -1, z: 2 },
				{ x: 0.5, y: 1, z: 2 },
				{ x: 0.5, y: 1, z: 8 },
				CYLINDER
			)
		).toBe(true);
	});

	it('does not treat a wall outside the shaft radius as a collision', () => {
		expect(
			triangleIntersectsVerticalCylinder(
				{ x: 0.7, y: -1, z: 2 },
				{ x: 0.7, y: 1, z: 2 },
				{ x: 0.7, y: 1, z: 8 },
				CYLINDER
			)
		).toBe(false);
	});

	it('clips sloped triangles to the finite shaft height before testing distance', () => {
		expect(
			triangleIntersectsVerticalCylinder(
				{ x: 0, y: 0, z: 0 },
				{ x: 10, y: -1, z: 10 },
				{ x: 10, y: 1, z: 10 },
				{ ...CYLINDER, minimumZMm: 9, maximumZMm: 10 }
			)
		).toBe(false);
	});

	it('indexes transformed triangles for repeated automatic-support queries', () => {
		const positions = Float32Array.from([0.5, -1, 2, 0.5, 1, 2, 0.5, 1, 8]);
		const index = new VerticalModelCollisionIndex(
			{
				positions,
				bounds: {
					min: { x: 0.5, y: -1, z: 2 },
					max: { x: 0.5, y: 1, z: 8 }
				}
			},
			ZERO_MODEL_TRANSLATION,
			IDENTITY_MODEL_ROTATION,
			1
		);

		expect(index.intersectsVerticalCylinder(CYLINDER)).toBe(true);
		expect(index.intersectsVerticalCylinder({ ...CYLINDER, x: 2 })).toBe(false);
	});

	it('recovers a downward-oriented face normal at a lower surface crossing', () => {
		const positions = Float32Array.from([0, 0, 5, 2, 0, 4, 0, 2, 5]);
		const index = new VerticalModelCollisionIndex(
			{
				positions,
				bounds: {
					min: { x: 0, y: 0, z: 4 },
					max: { x: 2, y: 2, z: 5 }
				}
			},
			ZERO_MODEL_TRANSLATION,
			IDENTITY_MODEL_ROTATION,
			1
		);

		const normal = index.normalAtLowerSurface(0.5, 0.5, 4.75);
		expect(normal?.x).toBeCloseTo(-1 / Math.sqrt(5));
		expect(normal?.y).toBeCloseTo(0);
		expect(normal?.z).toBeCloseTo(-2 / Math.sqrt(5));
	});
});
