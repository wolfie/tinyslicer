import { offsetRaftCore, type Point2, type RaftIsland } from './raft-plan';

/**
 * A closed triangle mesh for one raft island, ready to hand to a Three.js
 * `BufferGeometry`. Framework-free so it can be unit tested in Node; the
 * renderer only uploads the buffers.
 *
 * The mesh is the core slab (two caps) plus, when the island has a rim, three
 * quad strips around the perimeter: the rim underside (a 45° overhang — the
 * scraper's purchase), the vertical outer lip, and the rim top. Strip quads keep
 * their own vertices so every rim facet flat-shades crisply instead of smoothing
 * into the caps. Islands that hug a plate wall have no rim and get a plain slab
 * wall instead.
 */
export type RaftMeshData = {
	positions: Float32Array;
	normals: Float32Array;
	indices: Uint32Array;
};

const AREA_EPSILON = 1e-12;

function triangleArea2(a: Point2, b: Point2, c: Point2): number {
	return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

function pointInTriangle(p: Point2, a: Point2, b: Point2, c: Point2): boolean {
	const d1 = triangleArea2(p, a, b);
	const d2 = triangleArea2(p, b, c);
	const d3 = triangleArea2(p, c, a);
	const hasNegative = d1 < 0 || d2 < 0 || d3 < 0;
	const hasPositive = d1 > 0 || d2 > 0 || d3 > 0;
	return !(hasNegative && hasPositive);
}

/** Ear clipping for a simple CCW polygon. Returns CCW index triples. */
export function triangulateSimplePolygon(polygon: readonly Point2[]): number[] {
	const n = polygon.length;
	if (n < 3) return [];

	const remaining = [...polygon.keys()];
	const triangles: number[] = [];
	let guard = n * n;

	while (remaining.length > 3 && guard-- > 0) {
		let clipped = false;
		for (let i = 0; i < remaining.length; i += 1) {
			const previous = remaining[(i - 1 + remaining.length) % remaining.length];
			const current = remaining[i];
			const next = remaining[(i + 1) % remaining.length];
			if (triangleArea2(polygon[previous], polygon[current], polygon[next]) <= AREA_EPSILON)
				continue;

			let containsOther = false;
			for (const other of remaining) {
				if (other === previous || other === current || other === next) continue;
				if (pointInTriangle(polygon[other], polygon[previous], polygon[current], polygon[next])) {
					containsOther = true;
					break;
				}
			}
			if (containsOther) continue;

			triangles.push(previous, current, next);
			remaining.splice(i, 1);
			clipped = true;
			break;
		}
		if (!clipped) break;
	}

	if (remaining.length === 3) {
		triangles.push(remaining[0], remaining[1], remaining[2]);
	} else if (remaining.length > 3) {
		// Degenerate leftover (near-collinear): fan it so the cap still closes.
		for (let i = 1; i < remaining.length - 1; i += 1) {
			triangles.push(remaining[0], remaining[i], remaining[i + 1]);
		}
	}
	return triangles;
}

function computeNormals(positions: Float32Array, indices: readonly number[]): Float32Array {
	const normals = new Float32Array(positions.length);
	for (let i = 0; i < indices.length; i += 3) {
		const ia = indices[i] * 3;
		const ib = indices[i + 1] * 3;
		const ic = indices[i + 2] * 3;
		const ux = positions[ib] - positions[ia];
		const uy = positions[ib + 1] - positions[ia + 1];
		const uz = positions[ib + 2] - positions[ia + 2];
		const vx = positions[ic] - positions[ia];
		const vy = positions[ic + 1] - positions[ia + 1];
		const vz = positions[ic + 2] - positions[ia + 2];
		const nx = uy * vz - uz * vy;
		const ny = uz * vx - ux * vz;
		const nz = ux * vy - uy * vx;
		for (const base of [ia, ib, ic]) {
			normals[base] += nx;
			normals[base + 1] += ny;
			normals[base + 2] += nz;
		}
	}
	for (let i = 0; i < normals.length; i += 3) {
		const length = Math.hypot(normals[i], normals[i + 1], normals[i + 2]);
		if (length > AREA_EPSILON) {
			normals[i] /= length;
			normals[i + 1] /= length;
			normals[i + 2] /= length;
		} else {
			normals[i + 2] = 1;
		}
	}
	return normals;
}

export function raftMeshData(island: RaftIsland): RaftMeshData {
	const core = island.core;
	const n = core.length;
	const ch = island.coreHeightMm;
	const positions: number[] = [];
	const indices: number[] = [];

	const addVertex = (x: number, y: number, z: number) => {
		positions.push(x, y, z);
	};
	const addCap = (ring: readonly Point2[], z: number, faceUp: boolean) => {
		const base = positions.length / 3;
		for (const point of ring) addVertex(point.x, point.y, z);
		for (const [a, b, c] of chunk(triangulateSimplePolygon(ring))) {
			if (faceUp) indices.push(base + a, base + b, base + c);
			else indices.push(base + a, base + c, base + b);
		}
	};
	const addStrip = (
		lower: readonly Point2[],
		lowerZ: number,
		upper: readonly Point2[],
		upperZ: number
	) => {
		for (let i = 0; i < n; i += 1) {
			const j = (i + 1) % n;
			const base = positions.length / 3;
			addVertex(lower[i].x, lower[i].y, lowerZ);
			addVertex(lower[j].x, lower[j].y, lowerZ);
			addVertex(upper[j].x, upper[j].y, upperZ);
			addVertex(upper[i].x, upper[i].y, upperZ);
			indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
		}
	};

	addCap(core, ch, true); // top of the core "well"
	addCap(core, 0, false); // underside of the core

	if (island.brimWidthMm > 0) {
		const rise = island.brimWidthMm * Math.tan((island.brimAngleDeg * Math.PI) / 180);
		const outer = offsetRaftCore(island, island.brimWidthMm);
		addStrip(core, 0, outer, rise); // rim underside — the scraper overhang
		addStrip(outer, rise, outer, ch + rise); // rim outer lip
		addStrip(core, ch, outer, ch + rise); // rim top
	} else {
		addStrip(core, 0, core, ch); // plain slab wall
	}

	const positionArray = new Float32Array(positions);
	return {
		positions: positionArray,
		normals: computeNormals(positionArray, indices),
		indices: new Uint32Array(indices)
	};
}

function chunk(values: readonly number[]): number[][] {
	const out: number[][] = [];
	for (let i = 0; i < values.length; i += 3) out.push([values[i], values[i + 1], values[i + 2]]);
	return out;
}
