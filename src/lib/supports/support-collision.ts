import { Vector3 } from 'three';

import { createModelPointTransformer } from '$lib/workspace/build-volume-renderer/model-transform';
import type {
	ModelRotation,
	ModelScale,
	ModelTranslation
} from '$lib/workspace/build-volume-renderer/types';
import type { ImportedStlModel, Point3 } from '$lib/workspace/stl-importer';

export type VerticalCylinder = {
	x: number;
	y: number;
	minimumZMm: number;
	maximumZMm: number;
	radiusMm: number;
};

type Triangle = {
	a: Point3;
	b: Point3;
	c: Point3;
	normal: Point3;
	minimumX: number;
	maximumX: number;
	minimumY: number;
	maximumY: number;
	minimumZ: number;
	maximumZ: number;
};

const COLLISION_EPSILON_MM = 1e-7;
const SURFACE_CROSSING_EPSILON_MM = 2e-6;
const INDEX_CELL_SIZE_MM = 2;

function triangleNormal(a: Point3, b: Point3, c: Point3): Point3 {
	const abX = b.x - a.x;
	const abY = b.y - a.y;
	const abZ = b.z - a.z;
	const acX = c.x - a.x;
	const acY = c.y - a.y;
	const acZ = c.z - a.z;
	const x = abY * acZ - abZ * acY;
	const y = abZ * acX - abX * acZ;
	const z = abX * acY - abY * acX;
	const length = Math.hypot(x, y, z);
	return length > COLLISION_EPSILON_MM
		? { x: x / length, y: y / length, z: z / length }
		: { x: 0, y: 0, z: 0 };
}

function edge(start: Point3, end: Point3, x: number, y: number): number {
	return (end.x - start.x) * (y - start.y) - (end.y - start.y) * (x - start.x);
}

function triangleZAtXY(triangle: Triangle, x: number, y: number): number | null {
	const area = edge(triangle.a, triangle.b, triangle.c.x, triangle.c.y);
	if (Math.abs(area) <= COLLISION_EPSILON_MM) return null;
	const weightA = edge(triangle.b, triangle.c, x, y);
	const weightB = edge(triangle.c, triangle.a, x, y);
	const weightC = edge(triangle.a, triangle.b, x, y);
	const tolerance = Math.max(1, Math.abs(area)) * COLLISION_EPSILON_MM;
	if (
		area > 0
			? weightA < -tolerance || weightB < -tolerance || weightC < -tolerance
			: weightA > tolerance || weightB > tolerance || weightC > tolerance
	) {
		return null;
	}
	return (weightA * triangle.a.z + weightB * triangle.b.z + weightC * triangle.c.z) / area;
}

function interpolateAtZ(start: Point3, end: Point3, z: number): Point3 {
	const t = (z - start.z) / (end.z - start.z);
	return {
		x: start.x + (end.x - start.x) * t,
		y: start.y + (end.y - start.y) * t,
		z
	};
}

function clipAtZ(points: readonly Point3[], z: number, keepAbove: boolean): Point3[] {
	if (points.length === 0) return [];
	const clipped: Point3[] = [];
	let previous = points.at(-1)!;
	let previousInside = keepAbove
		? previous.z >= z - COLLISION_EPSILON_MM
		: previous.z <= z + COLLISION_EPSILON_MM;

	for (const current of points) {
		const currentInside = keepAbove
			? current.z >= z - COLLISION_EPSILON_MM
			: current.z <= z + COLLISION_EPSILON_MM;
		if (
			currentInside !== previousInside &&
			Math.abs(current.z - previous.z) > COLLISION_EPSILON_MM
		) {
			clipped.push(interpolateAtZ(previous, current, z));
		}
		if (currentInside) clipped.push(current);
		previous = current;
		previousInside = currentInside;
	}
	return clipped;
}

function squaredDistanceToSegment(x: number, y: number, start: Point3, end: Point3): number {
	const dx = end.x - start.x;
	const dy = end.y - start.y;
	const lengthSquared = dx * dx + dy * dy;
	if (lengthSquared <= COLLISION_EPSILON_MM * COLLISION_EPSILON_MM) {
		return (x - start.x) ** 2 + (y - start.y) ** 2;
	}
	const t = Math.max(0, Math.min(1, ((x - start.x) * dx + (y - start.y) * dy) / lengthSquared));
	const closestX = start.x + dx * t;
	const closestY = start.y + dy * t;
	return (x - closestX) ** 2 + (y - closestY) ** 2;
}

function projectedPolygonContains(points: readonly Point3[], x: number, y: number): boolean {
	let hasPositive = false;
	let hasNegative = false;
	for (let index = 0; index < points.length; index += 1) {
		const start = points[index];
		const end = points[(index + 1) % points.length];
		const cross = (end.x - start.x) * (y - start.y) - (end.y - start.y) * (x - start.x);
		if (cross > COLLISION_EPSILON_MM) hasPositive = true;
		else if (cross < -COLLISION_EPSILON_MM) hasNegative = true;
		if (hasPositive && hasNegative) return false;
	}
	return hasPositive || hasNegative;
}

/** Exact triangle-versus-solid-cylinder test for a cylinder aligned with build Z. */
export function triangleIntersectsVerticalCylinder(
	a: Point3,
	b: Point3,
	c: Point3,
	cylinder: VerticalCylinder
): boolean {
	const minimumZ = Math.min(cylinder.minimumZMm, cylinder.maximumZMm);
	const maximumZ = Math.max(cylinder.minimumZMm, cylinder.maximumZMm);
	let clipped = clipAtZ([a, b, c], minimumZ, true);
	clipped = clipAtZ(clipped, maximumZ, false);
	if (clipped.length === 0) return false;

	const radiusSquared = (cylinder.radiusMm + COLLISION_EPSILON_MM) ** 2;
	for (let index = 0; index < clipped.length; index += 1) {
		if (
			squaredDistanceToSegment(
				cylinder.x,
				cylinder.y,
				clipped[index],
				clipped[(index + 1) % clipped.length]
			) <= radiusSquared
		) {
			return true;
		}
	}
	return projectedPolygonContains(clipped, cylinder.x, cylinder.y);
}

/**
 * A small XY grid over transformed model triangles. Support generation may test
 * hundreds of candidate shafts, so broad-phase bins avoid rescanning the STL for
 * each finite-radius collision query.
 */
export class VerticalModelCollisionIndex {
	readonly #triangles: readonly Triangle[];
	readonly #cells = new Map<string, number[]>();

	constructor(
		model: Pick<ImportedStlModel, 'positions' | 'bounds'>,
		translation: ModelTranslation,
		rotation: ModelRotation,
		scale: ModelScale
	) {
		const transform = createModelPointTransformer(model.bounds, translation, rotation, scale);
		const transformed = new Vector3();
		const triangles: Triangle[] = [];
		for (let offset = 0; offset < model.positions.length; offset += 9) {
			const point = (vertexOffset: number): Point3 => {
				transform(
					model.positions[offset + vertexOffset],
					model.positions[offset + vertexOffset + 1],
					model.positions[offset + vertexOffset + 2],
					transformed
				);
				return { x: transformed.x, y: transformed.y, z: transformed.z };
			};
			const a = point(0);
			const b = point(3);
			const c = point(6);
			triangles.push({
				a,
				b,
				c,
				normal: triangleNormal(a, b, c),
				minimumX: Math.min(a.x, b.x, c.x),
				maximumX: Math.max(a.x, b.x, c.x),
				minimumY: Math.min(a.y, b.y, c.y),
				maximumY: Math.max(a.y, b.y, c.y),
				minimumZ: Math.min(a.z, b.z, c.z),
				maximumZ: Math.max(a.z, b.z, c.z)
			});
		}
		this.#triangles = triangles;

		for (let triangleIndex = 0; triangleIndex < triangles.length; triangleIndex += 1) {
			const triangle = triangles[triangleIndex];
			const minimumColumn = Math.floor(triangle.minimumX / INDEX_CELL_SIZE_MM);
			const maximumColumn = Math.floor(triangle.maximumX / INDEX_CELL_SIZE_MM);
			const minimumRow = Math.floor(triangle.minimumY / INDEX_CELL_SIZE_MM);
			const maximumRow = Math.floor(triangle.maximumY / INDEX_CELL_SIZE_MM);
			for (let row = minimumRow; row <= maximumRow; row += 1) {
				for (let column = minimumColumn; column <= maximumColumn; column += 1) {
					const key = `${column}:${row}`;
					const cell = this.#cells.get(key);
					if (cell) cell.push(triangleIndex);
					else this.#cells.set(key, [triangleIndex]);
				}
			}
		}
	}

	/** Returns the outward/downward face normal at a cached vertical-ray crossing. */
	normalAtLowerSurface(x: number, y: number, zMm: number): Point3 | null {
		const candidates = this.#cells.get(
			`${Math.floor(x / INDEX_CELL_SIZE_MM)}:${Math.floor(y / INDEX_CELL_SIZE_MM)}`
		);
		if (!candidates) return null;

		let closest: { normal: Point3; delta: number } | null = null;
		for (const triangleIndex of candidates) {
			const triangle = this.#triangles[triangleIndex];
			if (
				x < triangle.minimumX - COLLISION_EPSILON_MM ||
				x > triangle.maximumX + COLLISION_EPSILON_MM ||
				y < triangle.minimumY - COLLISION_EPSILON_MM ||
				y > triangle.maximumY + COLLISION_EPSILON_MM
			) {
				continue;
			}
			const crossingZ = triangleZAtXY(triangle, x, y);
			if (crossingZ === null) continue;
			const delta = Math.abs(crossingZ - zMm);
			if (delta > SURFACE_CROSSING_EPSILON_MM || (closest && delta >= closest.delta)) continue;

			const direction = triangle.normal.z > 0 ? -1 : 1;
			closest = {
				normal: {
					x: triangle.normal.x * direction,
					y: triangle.normal.y * direction,
					z: triangle.normal.z * direction
				},
				delta
			};
		}
		return closest?.normal ?? null;
	}

	intersectsVerticalCylinder(cylinder: VerticalCylinder): boolean {
		const minimumZ = Math.min(cylinder.minimumZMm, cylinder.maximumZMm);
		const maximumZ = Math.max(cylinder.minimumZMm, cylinder.maximumZMm);
		const minimumColumn = Math.floor((cylinder.x - cylinder.radiusMm) / INDEX_CELL_SIZE_MM);
		const maximumColumn = Math.floor((cylinder.x + cylinder.radiusMm) / INDEX_CELL_SIZE_MM);
		const minimumRow = Math.floor((cylinder.y - cylinder.radiusMm) / INDEX_CELL_SIZE_MM);
		const maximumRow = Math.floor((cylinder.y + cylinder.radiusMm) / INDEX_CELL_SIZE_MM);
		const candidates = new Set<number>();
		for (let row = minimumRow; row <= maximumRow; row += 1) {
			for (let column = minimumColumn; column <= maximumColumn; column += 1) {
				for (const triangleIndex of this.#cells.get(`${column}:${row}`) ?? []) {
					candidates.add(triangleIndex);
				}
			}
		}

		for (const triangleIndex of candidates) {
			const triangle = this.#triangles[triangleIndex];
			if (
				triangle.maximumZ < minimumZ - COLLISION_EPSILON_MM ||
				triangle.minimumZ > maximumZ + COLLISION_EPSILON_MM ||
				triangle.maximumX < cylinder.x - cylinder.radiusMm - COLLISION_EPSILON_MM ||
				triangle.minimumX > cylinder.x + cylinder.radiusMm + COLLISION_EPSILON_MM ||
				triangle.maximumY < cylinder.y - cylinder.radiusMm - COLLISION_EPSILON_MM ||
				triangle.minimumY > cylinder.y + cylinder.radiusMm + COLLISION_EPSILON_MM
			) {
				continue;
			}
			if (triangleIntersectsVerticalCylinder(triangle.a, triangle.b, triangle.c, cylinder)) {
				return true;
			}
		}
		return false;
	}
}
