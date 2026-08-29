import { describe, expect, it } from 'vitest';

import type { SupportPlan } from '$lib/workspace/supports';
import { supportPartCircleAtZ, supportPlanCirclesAtZ } from './support-cross-sections';

describe('supportPartCircleAtZ', () => {
	it('sections a vertical shaft into a constant circle along its span', () => {
		const shaft = {
			kind: 'shaft',
			start: { x: 10, y: 8, z: 2 },
			end: { x: 10, y: 8, z: 12 },
			startDiameter: 1.275,
			endDiameter: 1.275
		} as const;

		expect(supportPartCircleAtZ(shaft, 2)).toEqual({ xMm: 10, yMm: 8, radiusMm: 0.6375 });
		expect(supportPartCircleAtZ(shaft, 7)).toEqual({ xMm: 10, yMm: 8, radiusMm: 0.6375 });
		expect(supportPartCircleAtZ(shaft, 12)).toEqual({ xMm: 10, yMm: 8, radiusMm: 0.6375 });
	});

	it('returns null when the plane misses the part', () => {
		const foot = {
			kind: 'foot',
			start: { x: 4, y: 4, z: 0 },
			end: { x: 4, y: 4, z: 1 },
			startDiameter: 4,
			endDiameter: 1.275
		} as const;

		expect(supportPartCircleAtZ(foot, -0.01)).toBeNull();
		expect(supportPartCircleAtZ(foot, 1.01)).toBeNull();
	});

	it('interpolates centre and radius along an angled tapered neck', () => {
		const neck = {
			kind: 'neck',
			start: { x: 0, y: 0, z: 0 },
			end: { x: 2, y: 0, z: 4 },
			startDiameter: 0.8,
			endDiameter: 0.4
		} as const;

		const circle = supportPartCircleAtZ(neck, 1);
		expect(circle?.xMm).toBeCloseTo(0.5);
		expect(circle?.yMm).toBeCloseTo(0);
		expect(circle?.radiusMm).toBeCloseTo((0.8 - 0.1) / 2);
	});

	it('sections a junction sphere into a circle that shrinks away from its centre', () => {
		const junction = { kind: 'junction', center: { x: 5, y: 6, z: 10 }, diameter: 2 } as const;

		expect(supportPartCircleAtZ(junction, 10)).toEqual({ xMm: 5, yMm: 6, radiusMm: 1 });
		expect(supportPartCircleAtZ(junction, 10 + Math.sqrt(0.75))?.radiusMm).toBeCloseTo(0.5);
		expect(supportPartCircleAtZ(junction, 11)).toBeNull();
	});
});

describe('supportPlanCirclesAtZ', () => {
	it('collects one circle per part the plane crosses and drops zero-radius grazes', () => {
		const plan: SupportPlan = {
			structures: [
				{
					id: 'post:support-point-1',
					pointIds: ['support-point-1'],
					parts: [
						{
							kind: 'shaft',
							start: { x: 10, y: 8, z: 1 },
							end: { x: 10, y: 8, z: 20 },
							startDiameter: 1.275,
							endDiameter: 1.275
						},
						{ kind: 'junction', center: { x: 10, y: 8, z: 5 }, diameter: 1.275 }
					]
				}
			],
			unresolvedPoints: []
		};

		expect(supportPlanCirclesAtZ(plan, 5)).toHaveLength(2);
		// Plane above the junction but still inside the shaft.
		expect(supportPlanCirclesAtZ(plan, 12)).toEqual([{ xMm: 10, yMm: 8, radiusMm: 0.6375 }]);
		// Plane past every part.
		expect(supportPlanCirclesAtZ(plan, 25)).toEqual([]);
	});

	it('ignores unresolved support points', () => {
		const plan: SupportPlan = {
			structures: [],
			unresolvedPoints: [{ pointId: 'support-point-9', reason: 'insufficient-height' }]
		};

		expect(supportPlanCirclesAtZ(plan, 1)).toEqual([]);
	});
});
