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

	it('adds proposed braces to the output plan only after explicit opt-in', () => {
		const onOutputChanged = vi.fn();
		const supports = new SupportsState(undefined, () => {}, undefined, onOutputChanged);
		supports.add({
			position: { x: 5, y: 5, z: 5 },
			normal: { x: 0, y: 0, z: -1 }
		});
		supports.analysis.result = {
			meshIsWatertightAtPixelSamples: true,
			analyzedLayerCount: 10,
			disconnectedRegionCount: 0,
			disconnectedLayerCount: 0,
			firstDisconnectedLayerIndex: null,
			firstDisconnectedZMm: null,
			regions: [],
			coverage: {
				missingContactCount: 0,
				islandRiskCount: 0,
				overhangRiskCount: 0,
				coverageRadiusMm: 3,
				risks: []
			},
			stability: { slenderSupportCount: 1, maximumSlendernessRatio: 25, risks: [] },
			bracing: {
				structures: [
					{
						id: 'brace:a:b',
						pointIds: ['a', 'b'],
						parts: [
							{
								kind: 'shaft',
								start: { x: 0, y: 0, z: 1 },
								end: { x: 2, y: 0, z: 3 },
								startDiameter: 0.8,
								endDiameter: 0.8
							}
						]
					}
				],
				beamCount: 1,
				unbracedSupportPointIds: []
			}
		};

		expect(supports.plan.structures).toHaveLength(1);
		supports.setBracingEnabled(true);
		expect(supports.plan.structures.map((structure) => structure.id)).toEqual([
			'post:support-point-1',
			'brace:a:b'
		]);
		supports.setBracingEnabled(false);
		expect(supports.plan.structures).toHaveLength(1);
		expect(onOutputChanged).toHaveBeenCalledTimes(2);
	});
});
