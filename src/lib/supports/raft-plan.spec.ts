import { describe, expect, it } from 'vitest';

import {
	clusterByProximity,
	convexHull,
	generateRaftPlan,
	offsetRaftCore,
	raftCrossSectionAtZ,
	raftTotalHeightMm,
	RAFT_BRIM_ANGLE_DEGREES,
	RAFT_BRIM_PLATE_CLEARANCE_MM,
	RAFT_BRIM_WIDTH_MM,
	RAFT_BINDING_DISTANCE_MM,
	RAFT_CORE_HEIGHT_MM,
	RAFT_CORE_RADIUS_MM,
	type Point2,
	type RaftFoot
} from './raft-plan';

function foot(id: string, x: number, y: number): RaftFoot {
	return { id, center: { x, y } };
}

function signedArea(polygon: readonly Point2[]): number {
	let sum = 0;
	for (let i = 0; i < polygon.length; i += 1) {
		const a = polygon[i];
		const b = polygon[(i + 1) % polygon.length];
		sum += a.x * b.y - b.x * a.y;
	}
	return sum / 2;
}

function pointInPolygon(point: Point2, polygon: readonly Point2[]): boolean {
	let inside = false;
	for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
		const a = polygon[i];
		const b = polygon[j];
		const straddles = a.y > point.y !== b.y > point.y;
		if (straddles && point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x)
			inside = !inside;
	}
	return inside;
}

function distanceToPolygonEdges(point: Point2, polygon: readonly Point2[]): number {
	let best = Infinity;
	for (let i = 0; i < polygon.length; i += 1) {
		const a = polygon[i];
		const b = polygon[(i + 1) % polygon.length];
		const dx = b.x - a.x;
		const dy = b.y - a.y;
		const lengthSquared = dx * dx + dy * dy || 1;
		const t = Math.max(
			0,
			Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared)
		);
		const cx = a.x + t * dx;
		const cy = a.y + t * dy;
		best = Math.min(best, Math.hypot(point.x - cx, point.y - cy));
	}
	return best;
}

describe('clusterByProximity', () => {
	it('links points within the distance and separates the rest', () => {
		const clusters = clusterByProximity(
			[
				{ x: 0, y: 0 },
				{ x: 3, y: 0 },
				{ x: 20, y: 0 }
			],
			5
		);
		expect(clusters).toEqual([[0, 1], [2]]);
	});

	it('is transitive: a chain of close points forms one cluster', () => {
		const clusters = clusterByProximity(
			[
				{ x: 0, y: 0 },
				{ x: 5, y: 0 },
				{ x: 10, y: 0 }
			],
			6
		);
		expect(clusters).toEqual([[0, 1, 2]]);
	});
});

describe('convexHull', () => {
	it('returns a CCW hull and drops collinear and interior points', () => {
		const hull = convexHull([
			{ x: 0, y: 0 },
			{ x: 2, y: 0 },
			{ x: 4, y: 0 },
			{ x: 4, y: 4 },
			{ x: 0, y: 4 },
			{ x: 2, y: 2 }
		]);
		expect(hull).toEqual([
			{ x: 0, y: 0 },
			{ x: 4, y: 0 },
			{ x: 4, y: 4 },
			{ x: 0, y: 4 }
		]);
		expect(signedArea(hull)).toBeGreaterThan(0);
	});

	it('keeps two distinct points as a degenerate hull', () => {
		expect(
			convexHull([
				{ x: 1, y: 1 },
				{ x: 5, y: 1 }
			])
		).toHaveLength(2);
	});
});

describe('generateRaftPlan', () => {
	it('binds feet closer than the binding distance into one island', () => {
		const plan = generateRaftPlan([
			foot('support-point-1', 15, 15),
			foot('support-point-2', 20, 15)
		]);

		expect(plan.islands).toHaveLength(1);
		expect(plan.islands[0].supportPointIds).toEqual(['support-point-1', 'support-point-2']);
		expect(plan.raftedSupportPointIds).toEqual(new Set(['support-point-1', 'support-point-2']));
		expect(plan.islands[0].coreHeightMm).toBe(RAFT_CORE_HEIGHT_MM);
		expect(plan.islands[0].brimAngleDeg).toBe(RAFT_BRIM_ANGLE_DEGREES);
		expect(plan.islands[0].brimWidthMm).toBeCloseTo(RAFT_BRIM_WIDTH_MM);
		expect(plan.islands[0].hull.length).toBeGreaterThanOrEqual(2);
	});

	it('leaves feet farther apart than the binding distance unrafted', () => {
		const plan = generateRaftPlan([
			foot('support-point-1', 10, 15),
			foot('support-point-2', 10 + RAFT_BINDING_DISTANCE_MM + 1, 15)
		]);
		expect(plan.islands).toEqual([]);
		expect(plan.raftedSupportPointIds.size).toBe(0);
	});

	it('does not raft a lone foot', () => {
		const plan = generateRaftPlan([foot('support-point-1', 15, 15)]);
		expect(plan.islands).toEqual([]);
	});

	it('merges a transitive chain even when the ends are far apart', () => {
		const plan = generateRaftPlan([
			foot('support-point-1', 10, 15),
			foot('support-point-2', 15, 15),
			foot('support-point-3', 20, 15)
		]);
		expect(plan.islands).toHaveLength(1);
		expect(plan.islands[0].supportPointIds).toHaveLength(3);
	});

	it('covers every member foot centre with the core, CCW', () => {
		const centres = [
			{ x: 14, y: 14 },
			{ x: 19, y: 15 },
			{ x: 16, y: 18 }
		];
		const plan = generateRaftPlan(centres.map((c, i) => foot(`support-point-${i + 1}`, c.x, c.y)));
		const island = plan.islands[0];

		expect(signedArea(island.core)).toBeGreaterThan(0);
		for (const centre of centres) {
			expect(pointInPolygon(centre, island.core)).toBe(true);
			expect(distanceToPolygonEdges(centre, island.core)).toBeGreaterThan(
				RAFT_CORE_RADIUS_MM - 0.05
			);
		}
	});

	it('is order-independent', () => {
		const feet = [
			foot('support-point-1', 12, 12),
			foot('support-point-2', 16, 13),
			foot('support-point-3', 14, 17)
		];
		const forward = generateRaftPlan(feet);
		const shuffled = generateRaftPlan([feet[2], feet[0], feet[1]]);
		expect(shuffled.islands).toEqual(forward.islands);
	});

	it('clamps the rim as the island approaches a plate wall', () => {
		const interior = generateRaftPlan([
			foot('support-point-1', 15, 15),
			foot('support-point-2', 20, 15)
		]).islands[0];
		expect(interior.brimWidthMm).toBeCloseTo(RAFT_BRIM_WIDTH_MM);

		const near = generateRaftPlan([
			foot('support-point-1', 15, 2.7),
			foot('support-point-2', 20, 2.7)
		]).islands[0];
		expect(near.brimWidthMm).toBeGreaterThan(0);
		expect(near.brimWidthMm).toBeLessThan(RAFT_BRIM_WIDTH_MM);
		const wallGap = Math.min(...near.core.map((p) => p.y));
		expect(near.brimWidthMm).toBeCloseTo(wallGap - RAFT_BRIM_PLATE_CLEARANCE_MM, 5);

		const hugging = generateRaftPlan([
			foot('support-point-1', 15, 1.8),
			foot('support-point-2', 20, 1.8)
		]).islands[0];
		expect(hugging.brimWidthMm).toBe(0);
	});
});

describe('raftCrossSectionAtZ', () => {
	const island = generateRaftPlan([
		foot('support-point-1', 15, 15),
		foot('support-point-2', 20, 16)
	]).islands[0];
	const spanX = (ring: Point2[]) =>
		Math.max(...ring.map((p) => p.x)) - Math.min(...ring.map((p) => p.x));

	it('is one solid ring up to the core height', () => {
		const low = raftCrossSectionAtZ(island, 0.1);
		expect(low).toHaveLength(1);
		expect(pointInPolygon({ x: 15, y: 15 }, low[0])).toBe(true);
		expect(pointInPolygon({ x: 20, y: 16 }, low[0])).toBe(true);
	});

	it('becomes an outer ring with a hole once the core is gone', () => {
		const high = raftCrossSectionAtZ(island, island.coreHeightMm + island.brimWidthMm * 0.5);
		expect(high).toHaveLength(2);
		expect(spanX(high[0])).toBeGreaterThan(spanX(high[1]));
		// a member foot is inside both rings, so even-odd parity leaves it unprinted
		expect(pointInPolygon({ x: 15, y: 15 }, high[0])).toBe(true);
		expect(pointInPolygon({ x: 15, y: 15 }, high[1])).toBe(true);
	});

	it('marches the rim outward as height increases', () => {
		const lower = raftCrossSectionAtZ(island, island.coreHeightMm + 0.2)[0];
		const upper = raftCrossSectionAtZ(island, island.coreHeightMm + 0.6)[0];
		expect(Math.max(...upper.map((p) => p.x))).toBeGreaterThan(Math.max(...lower.map((p) => p.x)));
	});

	it('vanishes above the rim and at or below the plate', () => {
		expect(raftCrossSectionAtZ(island, raftTotalHeightMm(island) + 0.05)).toEqual([]);
		expect(raftCrossSectionAtZ(island, 0)).toEqual([]);
		expect(raftCrossSectionAtZ(island, -1)).toEqual([]);
	});

	it('offsets the core ring by a matching vertex count', () => {
		expect(offsetRaftCore(island, island.brimWidthMm)).toHaveLength(island.core.length);
	});
});
