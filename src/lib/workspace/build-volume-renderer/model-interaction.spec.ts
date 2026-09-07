import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';

import { scaleAlongRay } from './model-interaction';

describe('perspective scale dragging', () => {
	it('maps the pointer ray to the closest point on the anchor-to-handle line', () => {
		const scale = scaleAlongRay(
			new Vector3(20, 0, 10),
			new Vector3(-1, 0, 0).normalize(),
			new Vector3(0, 0, 0),
			new Vector3(10, 0, 5),
			1
		);

		expect(scale).toBeCloseTo(2);
	});

	it('clamps a dragged handle before it crosses the fixed anchor', () => {
		const scale = scaleAlongRay(
			new Vector3(-10, 0, -5),
			new Vector3(-1, 0, 0).normalize(),
			new Vector3(0, 0, 0),
			new Vector3(10, 0, 5),
			1
		);

		expect(scale).toBe(0.01);
	});
});
