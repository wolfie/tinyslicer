import { describe, expect, it, vi } from 'vitest';

import type { ModelSurfaceHit } from './supports';
import { SupportsState } from './supports-state.svelte';

const initialHit: ModelSurfaceHit = {
	position: { x: 1, y: 2, z: 3 },
	normal: { x: 0, y: 0, z: -1 },
	lowerContactPosition: { x: 1, y: 2, z: 1 }
};

describe('SupportsState', () => {
	it('moves an existing point to a new surface hit while preserving its id', () => {
		const onChanged = vi.fn();
		const supports = new SupportsState(undefined, onChanged);
		supports.add(initialHit);
		const originalPoint = supports.points[0];
		const movedHit: ModelSurfaceHit = {
			position: { x: 4, y: 5, z: 6 },
			normal: { x: 1, y: 0, z: 0 }
		};

		expect(supports.move(originalPoint.id, movedHit)).toBe(true);
		expect(supports.points).toEqual([{ id: originalPoint.id, ...movedHit }]);
		expect(supports.points[0]).not.toBe(originalPoint);
		expect(onChanged).toHaveBeenCalledTimes(2);
	});

	it('does not change the point set for an unknown id', () => {
		const onChanged = vi.fn();
		const supports = new SupportsState(undefined, onChanged);
		supports.add(initialHit);
		const points = supports.points;

		expect(supports.move('missing', initialHit)).toBe(false);
		expect(supports.points).toBe(points);
		expect(onChanged).toHaveBeenCalledTimes(1);
	});
});
