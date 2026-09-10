import { describe, expect, it } from 'vitest';

import { generateRaftPlan, RAFT_CORE_HEIGHT_MM } from '$lib/supports/raft-plan';
import {
	createPostSupportStructure,
	generateSupportPlan,
	isSupportFootInsideBuildPlate,
	SUPPORT_FOOT_DIAMETER_MM,
	SUPPORT_FOOT_HEIGHT_MM,
	SUPPORT_JUNCTION_DIAMETER_MM,
	SUPPORT_MAX_NECK_ANGLE_DEGREES,
	SUPPORT_CONTACT_DIAMETER_MM,
	SUPPORT_CONTACT_PENETRATION_MM,
	SUPPORT_NECK_DIAMETER_MM,
	SUPPORT_NECK_LENGTH_MM,
	SUPPORT_PLATE_EDGE_MARGIN_MM,
	supportFootCenter,
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
			end: { x: 12, y: 14, z: 10 + SUPPORT_CONTACT_PENETRATION_MM }
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
			start: { x: 12, y: 14, z: 3 - SUPPORT_CONTACT_PENETRATION_MM },
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
			end: { x: 12, y: 14, z: 10 + SUPPORT_CONTACT_PENETRATION_MM }
		});
	});

	it('penetrates an angled contact along the neck axis without changing its diameter', () => {
		const structure = createPostSupportStructure({
			id: 'support-point-1',
			position: { x: 12, y: 14, z: 10 },
			normal: { x: 1, y: 0, z: -1 }
		});
		const neck = structure?.parts.at(-1);

		expect(neck).toMatchObject({
			kind: 'neck',
			endDiameter: SUPPORT_CONTACT_DIAMETER_MM
		});
		expect(neck && 'end' in neck ? neck.end.x : undefined).toBeCloseTo(
			12 - SUPPORT_CONTACT_PENETRATION_MM / Math.sqrt(2)
		);
		expect(neck && 'end' in neck ? neck.end.z : undefined).toBeCloseTo(
			10 + SUPPORT_CONTACT_PENETRATION_MM / Math.sqrt(2)
		);
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

	it('uses a conservative edge margin covering the foot and maximum neck displacement', () => {
		expect(SUPPORT_PLATE_EDGE_MARGIN_MM).toBeCloseTo(
			SUPPORT_FOOT_DIAMETER_MM / 2 + SUPPORT_NECK_LENGTH_MM * Math.sin(Math.PI / 4)
		);
	});

	it('rejects a plate support when any part of its foot would cross the build-plate edge', () => {
		const point = {
			id: 'support-point-1',
			position: { x: 1, y: 14, z: 10 },
			normal: { x: 0, y: 0, z: -1 }
		};

		expect(isSupportFootInsideBuildPlate(point)).toBe(false);
		expect(createPostSupportStructure(point)).toBeNull();
		expect(generateSupportPlan([point])).toEqual({
			structures: [],
			unresolvedPoints: [{ pointId: point.id, reason: 'outside-build-plate' }]
		});
	});

	it('accounts for lateral neck displacement when checking the support foot', () => {
		const point = {
			id: 'support-point-1',
			position: { x: 2.5, y: 14, z: 10 },
			normal: { x: -1, y: 0, z: 0 }
		};

		expect(isSupportFootInsideBuildPlate(point)).toBe(false);
		expect(generateSupportPlan([point]).unresolvedPoints).toEqual([
			{ pointId: point.id, reason: 'outside-build-plate' }
		]);
	});

	it('allows a plate support whose complete foot touches the build-plate boundary', () => {
		const point = {
			id: 'support-point-1',
			position: { x: SUPPORT_FOOT_DIAMETER_MM / 2, y: 14, z: 10 },
			normal: { x: 0, y: 0, z: -1 }
		};

		expect(isSupportFootInsideBuildPlate(point)).toBe(true);
		expect(createPostSupportStructure(point)).not.toBeNull();
	});

	it('does not apply the build-plate foot check to a support ending on the model', () => {
		const point = {
			id: 'support-point-1',
			position: { x: 0.5, y: 14, z: 10 },
			normal: { x: 0, y: 0, z: -1 },
			lowerContactPosition: { x: 0.5, y: 14, z: 3 }
		};

		expect(isSupportFootInsideBuildPlate(point)).toBe(true);
		expect(createPostSupportStructure(point)).not.toBeNull();
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

describe('rafted supports', () => {
	function downwardContact(id: string, x: number, y: number, z = 10) {
		return { id, position: { x, y, z }, normal: { x: 0, y: 0, z: -1 } };
	}

	it('projects the foot centre onto the plate under the neck base', () => {
		const centre = supportFootCenter(downwardContact('support-point-1', 12, 14));
		expect(centre).toEqual({ x: 12, y: 14, z: 0 });
	});

	it('drops the flared foot and starts the shaft at the raft top', () => {
		const structure = createPostSupportStructure(
			downwardContact('support-point-1', 12, 14),
			RAFT_CORE_HEIGHT_MM
		);
		const kinds = structure?.parts.map((part) => part.kind);

		expect(kinds).toEqual(['shaft', 'junction', 'neck']);
		expect(structure?.parts[0]).toMatchObject({
			kind: 'shaft',
			start: { x: 12, y: 14, z: RAFT_CORE_HEIGHT_MM }
		});
	});

	it('rejects a rafted post whose contact sits at or below the raft top', () => {
		expect(
			createPostSupportStructure(
				downwardContact('support-point-1', 12, 14, 1.6),
				RAFT_CORE_HEIGHT_MM
			)
		).toBeNull();
	});

	it('rafts nearby plate contacts and keeps distant ones on their own feet', () => {
		const points = [
			downwardContact('support-point-1', 14, 15),
			downwardContact('support-point-2', 19, 15),
			downwardContact('support-point-3', 35, 15)
		];
		const raftPlan = generateRaftPlan(
			points.map((point) => ({ id: point.id, center: supportFootCenter(point) }))
		);
		expect(raftPlan.islands).toHaveLength(1);
		expect(raftPlan.raftedSupportPointIds).toEqual(new Set(['support-point-1', 'support-point-2']));

		const plan = generateSupportPlan(points, raftPlan.raftedSupportPointIds);
		const partKinds = Object.fromEntries(
			plan.structures.map((structure) => [
				structure.pointIds[0],
				structure.parts.map((p) => p.kind)
			])
		);
		expect(partKinds['support-point-1']).toEqual(['shaft', 'junction', 'neck']);
		expect(partKinds['support-point-2']).toEqual(['shaft', 'junction', 'neck']);
		expect(partKinds['support-point-3']).toEqual(['foot', 'shaft', 'junction', 'neck']);
	});

	it('keeps a structure for every rafted point', () => {
		const points = [
			downwardContact('support-point-1', 14, 15),
			downwardContact('support-point-2', 19, 15)
		];
		const raftedIds = new Set(points.map((point) => point.id));
		expect(generateSupportPlan(points, raftedIds).structures).toHaveLength(2);
	});
});
