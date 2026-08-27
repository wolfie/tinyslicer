import { describe, expect, it } from 'vitest';

import {
	createPostSupportStructure,
	generateSupportPlan,
	SUPPORT_FOOT_DIAMETER_MM,
	SUPPORT_FOOT_HEIGHT_MM,
	SUPPORT_JUNCTION_DIAMETER_MM,
	SUPPORT_MAX_NECK_ANGLE_DEGREES,
	SUPPORT_CONTACT_DIAMETER_MM,
	SUPPORT_NECK_DIAMETER_MM,
	SUPPORT_NECK_LENGTH_MM,
	supportNeckDirection
} from './supports';

describe('support post layout', () => {
	it('builds a vertical foot, shaft, and tapered neck under a downward-facing contact', () => {
		const structure = createPostSupportStructure({
			id: 'support-point-1',
			position: { x: 12, y: 14, z: 10 },
			normal: { x: 0, y: 0, z: -1 }
		});
		const [foot, shaft, junction, neck] = structure?.parts ?? [];

		expect(structure?.pointIds).toEqual(['support-point-1']);
		expect(foot).toEqual({
			kind: 'foot',
			start: { x: 12, y: 14, z: 0 },
			end: { x: 12, y: 14, z: SUPPORT_FOOT_HEIGHT_MM },
			startDiameter: SUPPORT_FOOT_DIAMETER_MM,
			endDiameter: 1.275
		});
		expect(shaft).toMatchObject({
			kind: 'shaft',
			start: foot && 'end' in foot ? foot.end : undefined,
			end: { x: 12, y: 14, z: 10 - SUPPORT_NECK_LENGTH_MM }
		});
		expect(junction).toEqual({
			kind: 'junction',
			center: shaft && 'end' in shaft ? shaft.end : undefined,
			diameter: SUPPORT_JUNCTION_DIAMETER_MM
		});
		expect(neck).toMatchObject({
			kind: 'neck',
			start: shaft && 'end' in shaft ? shaft.end : undefined,
			end: { x: 12, y: 14, z: 10 }
		});
	});

	it('ends on a lower model surface with an inverted tapered contact', () => {
		const structure = createPostSupportStructure({
			id: 'support-point-1',
			position: { x: 12, y: 14, z: 10 },
			normal: { x: 0, y: 0, z: -1 },
			lowerContactPosition: { x: 12, y: 14, z: 3 }
		});
		const [lowerNeck, lowerJunction, shaft, upperJunction, upperNeck] = structure?.parts ?? [];

		expect(lowerNeck).toEqual({
			kind: 'neck',
			start: { x: 12, y: 14, z: 3 },
			end: { x: 12, y: 14, z: 3 + SUPPORT_NECK_LENGTH_MM },
			startDiameter: SUPPORT_CONTACT_DIAMETER_MM,
			endDiameter: SUPPORT_NECK_DIAMETER_MM
		});
		expect(lowerJunction).toMatchObject({
			kind: 'junction',
			center: lowerNeck && 'end' in lowerNeck ? lowerNeck.end : undefined
		});
		expect(shaft).toMatchObject({
			kind: 'shaft',
			start: lowerNeck && 'end' in lowerNeck ? lowerNeck.end : undefined,
			end: { x: 12, y: 14, z: 10 - SUPPORT_NECK_LENGTH_MM }
		});
		expect(upperJunction).toMatchObject({
			kind: 'junction',
			center: shaft && 'end' in shaft ? shaft.end : undefined
		});
		expect(upperNeck).toMatchObject({
			kind: 'neck',
			start: shaft && 'end' in shaft ? shaft.end : undefined,
			end: { x: 12, y: 14, z: 10 }
		});
	});

	it(`limits a sideways neck to ${SUPPORT_MAX_NECK_ANGLE_DEGREES} degrees from vertical`, () => {
		const direction = supportNeckDirection({ x: 1, y: 0, z: 0 });
		const angleFromDown = Math.acos(-direction.z);

		expect((angleFromDown * 180) / Math.PI).toBeCloseTo(SUPPORT_MAX_NECK_ANGLE_DEGREES);
		expect(direction.x).toBeGreaterThan(0);
		expect(Math.hypot(direction.x, direction.y, direction.z)).toBeCloseTo(1);
	});

	it('preserves shallower downward surface angles', () => {
		const direction = supportNeckDirection({ x: 1, y: 0, z: -Math.sqrt(3) });

		expect((Math.acos(-direction.z) * 180) / Math.PI).toBeCloseTo(30);
	});

	it('reports a point as unresolved when it cannot produce a post', () => {
		const point = {
			id: 'support-point-1',
			position: { x: 12, y: 14, z: SUPPORT_FOOT_HEIGHT_MM + SUPPORT_NECK_LENGTH_MM },
			normal: { x: 0, y: 0, z: -1 }
		};

		expect(createPostSupportStructure(point)).toBeNull();
		expect(generateSupportPlan([point])).toEqual({
			structures: [],
			unresolvedPoints: [
				{
					pointId: 'support-point-1',
					reason: 'insufficient-height'
				}
			]
		});
	});

	it('generates structures without replacing or mutating their source points', () => {
		const point = {
			id: 'support-point-1',
			position: { x: 12, y: 14, z: 10 },
			normal: { x: 0, y: 0, z: -1 }
		};
		const original = structuredClone(point);

		const plan = generateSupportPlan([point]);

		expect(plan.structures).toHaveLength(1);
		expect(plan.structures[0].pointIds).toEqual([point.id]);
		expect(point).toEqual(original);
	});
});
