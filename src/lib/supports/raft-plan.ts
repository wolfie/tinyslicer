import { TINYMAKER_PROFILE } from '$lib/printer/tinymaker';

/**
 * Automatic rafts.
 *
 * While automatic supports are generated (and again after every manual edit),
 * the plate-anchored support feet are single-linkage clustered by proximity.
 * Every cluster of at least {@link RAFT_MIN_ISLAND_SUPPORTS} feet is bound into
 * one raft "island": a thin flat core slab under the feet, ringed by a rim that
 * leans up and outward at 45° like the brim of a dinner plate. The rim's
 * underside is a self-supporting overhang, so a scraper slides into the wedge of
 * air beneath it and levers the whole raft — and the model — off the plate.
 *
 * Geometry is framework-free and re-derived from scratch on each call, mirroring
 * `generateSupportPlan`. Nothing here touches Three.js or Svelte.
 */

export type Point2 = { x: number; y: number };

/** One plate-anchored support foot, identified so islands can name their members. */
export type RaftFoot = {
	id: string;
	center: Point2;
};

export type RaftIsland = {
	/** Stable across recompute: derived from the lowest-ordinal member id. */
	id: string;
	supportPointIds: string[];
	/** Convex hull of the member foot centres; every offset ring derives from it. */
	hull: Point2[];
	/** Flat core polygon, CCW: `hull` rounded out by `coreRadiusMm`. Feet seat here. */
	core: Point2[];
	coreRadiusMm: number;
	coreHeightMm: number;
	/** Rim reach past the core edge; `0` when the island hugs a plate wall. */
	brimWidthMm: number;
	brimAngleDeg: number;
};

export type RaftPlan = {
	islands: RaftIsland[];
	/** Members of any island; their supports drop the flared foot. */
	raftedSupportPointIds: Set<string>;
};

export type RaftPlanOptions = {
	bindingDistanceMm?: number;
	buildVolume?: { x: number; y: number };
};

/** Feet closer than this (centre to centre) share a raft island. */
export const RAFT_BINDING_DISTANCE_MM = 7;
/** Flat core-slab thickness, in whole layers — just enough to bond the feet to
 *  the plate; the rim does the scraper work. */
export const RAFT_CORE_LAYER_COUNT = 6;
export const RAFT_CORE_HEIGHT_MM = RAFT_CORE_LAYER_COUNT * TINYMAKER_PROFILE.layerHeight;
/** How far the core reaches past each member foot centre. */
export const RAFT_CORE_RADIUS_MM = 1.5;
export const RAFT_MIN_ISLAND_SUPPORTS = 2;
/** Horizontal reach of the rim past the core edge. At {@link RAFT_BRIM_ANGLE_DEGREES}
 *  it is also how far the rim's outer lip stands above the plate. */
export const RAFT_BRIM_WIDTH_MM = 1.5;
export const RAFT_BRIM_ANGLE_DEGREES = 45;
/** The rim is dropped entirely within this margin of a plate wall — it leans
 *  outward and would otherwise run off the plate. */
export const RAFT_BRIM_PLATE_CLEARANCE_MM = 0.5;
/** A clamped rim narrower than this is not worth printing; drop it to zero. */
export const RAFT_MIN_BRIM_WIDTH_MM = 0.2;

const RAFT_CORNER_ARC_SEGMENTS = 6;
const GEOMETRY_EPSILON = 1e-6;

/**
 * Single-linkage clusters of point indices: two indices land in the same cluster
 * when their points are within `distanceMm`. Cluster member lists are ascending;
 * clusters are ordered by their smallest member.
 */
export function clusterByProximity(points: readonly Point2[], distanceMm: number): number[][] {
	const parent = points.map((_, index) => index);
	const find = (index: number): number => {
		let root = index;
		while (parent[root] !== root) root = parent[root];
		while (parent[index] !== root) {
			const next = parent[index];
			parent[index] = root;
			index = next;
		}
		return root;
	};
	const union = (a: number, b: number) => {
		const rootA = find(a);
		const rootB = find(b);
		if (rootA === rootB) return;
		parent[Math.max(rootA, rootB)] = Math.min(rootA, rootB);
	};

	const thresholdSquared = distanceMm * distanceMm;
	for (let i = 0; i < points.length; i += 1) {
		for (let j = i + 1; j < points.length; j += 1) {
			const dx = points[i].x - points[j].x;
			const dy = points[i].y - points[j].y;
			if (dx * dx + dy * dy <= thresholdSquared + GEOMETRY_EPSILON) union(i, j);
		}
	}

	const clusters = new Map<number, number[]>();
	for (let index = 0; index < points.length; index += 1) {
		const root = find(index);
		const members = clusters.get(root);
		if (members) members.push(index);
		else clusters.set(root, [index]);
	}
	return [...clusters.values()].sort((a, b) => a[0] - b[0]);
}

/** Andrew's monotone chain. Returns a CCW hull; 1 or 2 points for degenerate input. */
export function convexHull(points: readonly Point2[]): Point2[] {
	const sorted = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
	const unique: Point2[] = [];
	for (const point of sorted) {
		const last = unique.at(-1);
		if (
			!last ||
			Math.abs(last.x - point.x) > GEOMETRY_EPSILON ||
			Math.abs(last.y - point.y) > GEOMETRY_EPSILON
		) {
			unique.push(point);
		}
	}
	if (unique.length <= 2) return unique;

	const cross = (o: Point2, a: Point2, b: Point2) =>
		(a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

	const lower: Point2[] = [];
	for (const point of unique) {
		while (
			lower.length >= 2 &&
			cross(lower[lower.length - 2], lower[lower.length - 1], point) <= 0
		) {
			lower.pop();
		}
		lower.push(point);
	}
	const upper: Point2[] = [];
	for (let i = unique.length - 1; i >= 0; i -= 1) {
		const point = unique[i];
		while (
			upper.length >= 2 &&
			cross(upper[upper.length - 2], upper[upper.length - 1], point) <= 0
		) {
			upper.pop();
		}
		upper.push(point);
	}
	lower.pop();
	upper.pop();
	return lower.concat(upper);
}

function edgeOutwardNormal(a: Point2, b: Point2): Point2 {
	const dx = b.x - a.x;
	const dy = b.y - a.y;
	const length = Math.hypot(dx, dy) || 1;
	// Right of travel is outward for a CCW polygon.
	return { x: dy / length, y: -dx / length };
}

function pointsOnCircle(center: Point2, radius: number, segments: number): Point2[] {
	const out: Point2[] = [];
	for (let s = 0; s < segments; s += 1) {
		const angle = (s / segments) * Math.PI * 2;
		out.push({ x: center.x + Math.cos(angle) * radius, y: center.y + Math.sin(angle) * radius });
	}
	return out;
}

/** Rounds a CCW convex hull outward by `radius`, arcing every corner. */
function roundedOffset(hull: readonly Point2[], radius: number, arcSegments: number): Point2[] {
	if (hull.length === 0) return [];
	if (hull.length === 1) return pointsOnCircle(hull[0], radius, Math.max(8, arcSegments * 4));

	const out: Point2[] = [];
	const n = hull.length;
	for (let i = 0; i < n; i += 1) {
		const previous = hull[(i - 1 + n) % n];
		const current = hull[i];
		const next = hull[(i + 1) % n];
		// For n === 2 both edges are the one segment walked in opposite directions,
		// so each corner arc is a half circle: the hull rounds into a stadium.
		const incoming = edgeOutwardNormal(previous, current);
		const outgoing = edgeOutwardNormal(current, next);
		const start = Math.atan2(incoming.y, incoming.x);
		let end = Math.atan2(outgoing.y, outgoing.x);
		while (end <= start + GEOMETRY_EPSILON) end += Math.PI * 2;
		const sweep = end - start;
		const steps = Math.max(1, Math.round((sweep / (Math.PI / 2)) * arcSegments));
		for (let s = 0; s <= steps; s += 1) {
			const angle = start + (sweep * s) / steps;
			out.push({
				x: current.x + Math.cos(angle) * radius,
				y: current.y + Math.sin(angle) * radius
			});
		}
	}
	return out;
}

/** Smallest distance from any polygon vertex to a build-plate wall. */
function minWallGap(polygon: readonly Point2[], buildVolume: { x: number; y: number }): number {
	let gap = Infinity;
	for (const point of polygon) {
		gap = Math.min(gap, point.x, point.y, buildVolume.x - point.x, buildVolume.y - point.y);
	}
	return gap;
}

function buildIsland(
	members: readonly RaftFoot[],
	buildVolume: { x: number; y: number }
): RaftIsland {
	const hull = convexHull(members.map((member) => ({ x: member.center.x, y: member.center.y })));
	const core = roundedOffset(hull, RAFT_CORE_RADIUS_MM, RAFT_CORNER_ARC_SEGMENTS);
	const roomForBrim = minWallGap(core, buildVolume) - RAFT_BRIM_PLATE_CLEARANCE_MM;
	const clampedBrim = Math.min(RAFT_BRIM_WIDTH_MM, roomForBrim);
	const brimWidthMm = clampedBrim >= RAFT_MIN_BRIM_WIDTH_MM ? clampedBrim : 0;

	return {
		id: `raft:${members[0].id}`,
		supportPointIds: members.map((member) => member.id),
		hull,
		core,
		coreRadiusMm: RAFT_CORE_RADIUS_MM,
		coreHeightMm: RAFT_CORE_HEIGHT_MM,
		brimWidthMm,
		brimAngleDeg: RAFT_BRIM_ANGLE_DEGREES
	};
}

/**
 * Binds nearby plate-anchored support feet into raft islands. Order-independent:
 * shuffling `feet` yields the same plan.
 */
export function generateRaftPlan(
	feet: readonly RaftFoot[],
	options: RaftPlanOptions = {}
): RaftPlan {
	const bindingDistanceMm = options.bindingDistanceMm ?? RAFT_BINDING_DISTANCE_MM;
	const buildVolume = options.buildVolume ?? TINYMAKER_PROFILE.buildVolume;
	const clusters = clusterByProximity(
		feet.map((foot) => foot.center),
		bindingDistanceMm
	);

	const islands: RaftIsland[] = [];
	const raftedSupportPointIds = new Set<string>();
	for (const memberIndices of clusters) {
		if (memberIndices.length < RAFT_MIN_ISLAND_SUPPORTS) continue;
		const members = memberIndices
			.map((index) => feet[index])
			.sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
		islands.push(buildIsland(members, buildVolume));
		for (const member of members) raftedSupportPointIds.add(member.id);
	}
	islands.sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));

	return { islands, raftedSupportPointIds };
}

/** The core outline pushed out by `extraMm` (`0` → the core itself). */
export function offsetRaftCore(island: RaftIsland, extraMm: number): Point2[] {
	if (extraMm <= GEOMETRY_EPSILON) return island.core;
	return roundedOffset(island.hull, island.coreRadiusMm + extraMm, RAFT_CORNER_ARC_SEGMENTS);
}

/** Vertical span the raft occupies: the core slab plus the rim's rise. */
export function raftTotalHeightMm(island: RaftIsland): number {
	return island.coreHeightMm + island.brimWidthMm * brimSlope(island);
}

function brimSlope(island: RaftIsland): number {
	return Math.tan((island.brimAngleDeg * Math.PI) / 180) || 1;
}

/**
 * The filled rings of the raft at height `zMm` — outer boundary first, then any
 * hole — to be composited into that layer with even-odd parity. Empty above the
 * rim and at/below the plate.
 *
 * Up to the core height it is one solid ring: the core, already widening into
 * the foot of the rim. Above the core the middle is gone and only the rim
 * survives, a ring that marches outward and finally closes on itself.
 */
export function raftCrossSectionAtZ(island: RaftIsland, zMm: number): Point2[][] {
	const ch = island.coreHeightMm;
	const bw = island.brimWidthMm;
	const slope = brimSlope(island);
	if (zMm <= GEOMETRY_EPSILON || zMm > ch + bw * slope + GEOMETRY_EPSILON) return [];

	const outerExtra = Math.min(bw, zMm / slope);
	const innerExtra = Math.max(0, (zMm - ch) / slope);
	if (innerExtra >= outerExtra - GEOMETRY_EPSILON) {
		// Only reachable with bw === 0: the bare core slab, no rim.
		return zMm <= ch + GEOMETRY_EPSILON ? [island.core] : [];
	}

	const rings = [offsetRaftCore(island, outerExtra)];
	if (innerExtra > GEOMETRY_EPSILON) rings.push(offsetRaftCore(island, innerExtra));
	return rings;
}
