import { describe, expect, it } from 'vitest';

import { createRotationRingGeometry, translationArrowPlaneWeights } from './transform-gizmo';

describe('translation arrow crossfade', () => {
	const facingAt = (degrees: number): [number, number] => {
		const radians = (degrees * Math.PI) / 180;
		return [Math.cos(radians), Math.sin(radians)];
	};

	it('shows only the plane facing the camera outside the transition', () => {
		expect(translationArrowPlaneWeights(...facingAt(0))).toEqual([1, 0]);
		expect(translationArrowPlaneWeights(...facingAt(30))).toEqual([1, 0]);
		expect(translationArrowPlaneWeights(...facingAt(60))).toEqual([0, 1]);
		expect(translationArrowPlaneWeights(...facingAt(90))).toEqual([0, 1]);
	});

	it('shows both planes fully when the camera is halfway between them', () => {
		const [firstWeight, crossedWeight] = translationArrowPlaneWeights(...facingAt(45));

		expect(firstWeight).toBeCloseTo(1);
		expect(crossedWeight).toBeCloseTo(1);
	});

	it('smoothly overlaps the planes through the transition', () => {
		const [firstWeight, crossedWeight] = translationArrowPlaneWeights(...facingAt(37.5));
		const [laterFirstWeight, laterCrossedWeight] = translationArrowPlaneWeights(...facingAt(52.5));

		expect(firstWeight).toBe(1);
		expect(crossedWeight).toBeGreaterThan(0);
		expect(crossedWeight).toBeLessThan(1);
		expect(laterFirstWeight).toBeGreaterThan(0);
		expect(laterFirstWeight).toBeLessThan(1);
		expect(laterCrossedWeight).toBe(1);
	});
});

describe('rotation ring geometry', () => {
	it('uses an upright circular band instead of a flat annulus', () => {
		const geometry = createRotationRingGeometry();
		geometry.computeBoundingBox();
		const bounds = geometry.boundingBox;

		expect(bounds).not.toBeNull();
		expect(bounds!.max.x - bounds!.min.x).toBeCloseTo(1.972);
		expect(bounds!.max.y - bounds!.min.y).toBeCloseTo(1.972);
		expect(bounds!.max.z - bounds!.min.z).toBeCloseTo(0.028);
		expect(geometry.parameters.openEnded).toBe(true);
		geometry.dispose();
	});
});
