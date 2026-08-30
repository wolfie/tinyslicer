import { describe, expect, it } from 'vitest';

import { raftMeshData, triangulateSimplePolygon } from './raft-geometry';
import { generateRaftPlan, raftTotalHeightMm, type Point2, type RaftFoot } from './raft-plan';

function foot(id: string, x: number, y: number): RaftFoot {
	return { id, center: { x, y } };
}

/** Interior cluster: has a full rim. */
function island() {
	return generateRaftPlan([
		foot('support-point-1', 14, 14),
		foot('support-point-2', 20, 15),
		foot('support-point-3', 16, 19)
	]).islands[0];
}

/** Cluster hard against the y = 0 wall: no rim, just a slab. */
function rimlessIsland() {
	return generateRaftPlan([foot('support-point-1', 15, 1.8), foot('support-point-2', 20, 1.8)])
		.islands[0];
}

describe('triangulateSimplePolygon', () => {
	it('fully triangulates a convex polygon', () => {
		const square: Point2[] = [
			{ x: 0, y: 0 },
			{ x: 2, y: 0 },
			{ x: 2, y: 2 },
			{ x: 0, y: 2 }
		];
		const triangles = triangulateSimplePolygon(square);
		expect(triangles).toHaveLength(6);

		let area = 0;
		for (let i = 0; i < triangles.length; i += 3) {
			const a = square[triangles[i]];
			const b = square[triangles[i + 1]];
			const c = square[triangles[i + 2]];
			area += ((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)) / 2;
		}
		expect(area).toBeCloseTo(4, 6);
	});

	it('handles an L-shaped concave polygon', () => {
		const shape: Point2[] = [
			{ x: 0, y: 0 },
			{ x: 3, y: 0 },
			{ x: 3, y: 1 },
			{ x: 1, y: 1 },
			{ x: 1, y: 3 },
			{ x: 0, y: 3 }
		];
		const triangles = triangulateSimplePolygon(shape);
		expect(triangles).toHaveLength((shape.length - 2) * 3);
	});
});

describe('raftMeshData', () => {
	it('spans from the plate to the top of the rim', () => {
		const raft = island();
		const data = raftMeshData(raft);
		const zs: number[] = [];
		for (let i = 2; i < data.positions.length; i += 3) zs.push(data.positions[i]);

		expect(Math.min(...zs)).toBe(0);
		expect(Math.max(...zs)).toBeCloseTo(raftTotalHeightMm(raft), 6);
	});

	it('a rimless island is just a core slab', () => {
		const raft = rimlessIsland();
		expect(raft.brimWidthMm).toBe(0);
		const data = raftMeshData(raft);
		for (let i = 2; i < data.positions.length; i += 3) {
			const z = data.positions[i];
			expect(z === 0 || Math.abs(z - raft.coreHeightMm) < 1e-6).toBe(true);
		}
	});

	it('produces a valid indexed mesh with unit normals', () => {
		for (const raft of [island(), rimlessIsland()]) {
			const data = raftMeshData(raft);
			const vertexCount = data.positions.length / 3;

			expect(data.indices.length % 3).toBe(0);
			expect(data.indices.length).toBeGreaterThan(0);
			for (const index of data.indices) {
				expect(index).toBeGreaterThanOrEqual(0);
				expect(index).toBeLessThan(vertexCount);
			}

			expect(data.normals).toHaveLength(data.positions.length);
			for (let i = 0; i < data.normals.length; i += 3) {
				const length = Math.hypot(data.normals[i], data.normals[i + 1], data.normals[i + 2]);
				expect(length).toBeCloseTo(1, 4);
			}
		}
	});

	it('references every vertex from at least one triangle', () => {
		const data = raftMeshData(island());
		const used = new Set(data.indices);
		expect(used.size).toBe(data.positions.length / 3);
	});
});
