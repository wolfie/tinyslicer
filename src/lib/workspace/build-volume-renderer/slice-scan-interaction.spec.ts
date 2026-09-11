import { PerspectiveCamera, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';

import { clampScanZ, verticalDragPlane } from './slice-scan-interaction';

describe('clampScanZ', () => {
	it('clamps below the plate and above the printed height', () => {
		expect(clampScanZ(-5, 10)).toBe(0);
		expect(clampScanZ(15, 10)).toBe(10);
		expect(clampScanZ(4, 10)).toBe(4);
	});
});

describe('verticalDragPlane', () => {
	it('passes through the hit point and stays horizontal-normal so Z motion stays on it', () => {
		const camera = new PerspectiveCamera();
		camera.position.set(50, -30, 40);
		const hitPoint = new Vector3(20, 15, 8);

		const plane = verticalDragPlane(camera, hitPoint);

		expect(plane.normal.z).toBeCloseTo(0);
		expect(plane.distanceToPoint(hitPoint)).toBeCloseTo(0);
		// Any point directly above/below the hit point must remain on the plane,
		// since dragging is expected to only ever move the point vertically.
		expect(plane.distanceToPoint(hitPoint.clone().setZ(55))).toBeCloseTo(0);
	});

	it('falls back to a fixed normal when the camera sits directly above the hit point', () => {
		const camera = new PerspectiveCamera();
		const hitPoint = new Vector3(20, 15, 8);
		camera.position.set(hitPoint.x, hitPoint.y, 90);

		const plane = verticalDragPlane(camera, hitPoint);

		expect(plane.normal.x).toBeCloseTo(0);
		expect(plane.normal.y).toBeCloseTo(1);
		expect(plane.normal.z).toBeCloseTo(0);
	});
});
