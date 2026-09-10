import { TINYMAKER_PROFILE } from '$lib/printer/tinymaker';
import { RAFT_CORE_HEIGHT_MM } from '$lib/supports/raft-plan';
import type { Bounds3, Point3 } from './stl-importer';

export const SUPPORT_SHAFT_DIAMETER_MM = 1.275;
export const SUPPORT_FOOT_DIAMETER_MM = 4;
export const SUPPORT_NECK_LENGTH_MM = 1.5;
export const SUPPORT_NECK_DIAMETER_MM = 0.8;
export const SUPPORT_CONTACT_DIAMETER_MM = 0.4;
/** Extends each contact into the model so the sliced parts overlap across several layers. */
export const SUPPORT_CONTACT_PENETRATION_MM = 0.2;
export const SUPPORT_JUNCTION_DIAMETER_MM = SUPPORT_SHAFT_DIAMETER_MM;
export const SUPPORT_MAX_NECK_ANGLE_DEGREES = 45;
export const SUPPORT_FOOT_FLARE_ANGLE_DEGREES = 45;
export const SUPPORT_FOOT_HEIGHT_MM =
	((SUPPORT_FOOT_DIAMETER_MM - SUPPORT_SHAFT_DIAMETER_MM) / 2) *
	Math.tan((SUPPORT_FOOT_FLARE_ANGLE_DEGREES * Math.PI) / 180);
export const SUPPORT_PLATE_EDGE_MARGIN_MM =
	SUPPORT_FOOT_DIAMETER_MM / 2 +
	SUPPORT_NECK_LENGTH_MM * Math.sin((SUPPORT_MAX_NECK_ANGLE_DEGREES * Math.PI) / 180);

const SUPPORT_GEOMETRY_EPSILON_MM = 1e-6;
const BUILD_VOLUME = TINYMAKER_PROFILE.buildVolume;

export type ModelSurfaceHit = {
	position: Point3;
	normal: Point3;
	lowerContactPosition?: Point3;
};

export type SupportPoint = ModelSurfaceHit & {
	id: string;
};

export type SupportFrustumPart = {
	kind: 'foot' | 'shaft' | 'neck';
	start: Point3;
	end: Point3;
	startDiameter: number;
	endDiameter: number;
};

export type SupportJunctionPart = {
	kind: 'junction';
	center: Point3;
	diameter: number;
};

export type SupportStructurePart = SupportFrustumPart | SupportJunctionPart;

export type SupportStructure = {
	id: string;
	pointIds: readonly string[];
	parts: readonly SupportStructurePart[];
};

export type UnresolvedSupportPoint = {
	pointId: string;
	reason: 'insufficient-height' | 'outside-build-plate';
};

export type SupportPlan = {
	structures: readonly SupportStructure[];
	unresolvedPoints: readonly UnresolvedSupportPoint[];
};

function normalizedHorizontal(point: Point3): Point3 | null {
	const length = Math.hypot(point.x, point.y);
	if (length <= SUPPORT_GEOMETRY_EPSILON_MM) return null;
	return { x: point.x / length, y: point.y / length, z: 0 };
}

/**
 * Returns the direction from the model contact toward the post's neck base.
 * The downward component ensures the neck grows from an earlier layer, while
 * the angle limit keeps its layer-to-layer lateral travel conservative.
 */
export function supportNeckDirection(normal: Point3): Point3 {
	const horizontal = normalizedHorizontal(normal);
	if (!horizontal) return { x: 0, y: 0, z: -1 };

	const normalLength = Math.hypot(normal.x, normal.y, normal.z);
	const normalizedZ = normalLength > SUPPORT_GEOMETRY_EPSILON_MM ? normal.z / normalLength : -1;
	const desiredAngle = Math.atan2(
		Math.hypot(normal.x, normal.y),
		Math.max(-normalizedZ * normalLength, SUPPORT_GEOMETRY_EPSILON_MM)
	);
	const maximumAngle = (SUPPORT_MAX_NECK_ANGLE_DEGREES * Math.PI) / 180;
	const angle = Math.min(desiredAngle, maximumAngle);

	return {
		x: horizontal.x * Math.sin(angle),
		y: horizontal.y * Math.sin(angle),
		z: -Math.cos(angle)
	};
}

export function supportNeckBase(point: ModelSurfaceHit): Point3 {
	const neckDirection = supportNeckDirection(point.normal);
	return {
		x: point.position.x + neckDirection.x * SUPPORT_NECK_LENGTH_MM,
		y: point.position.y + neckDirection.y * SUPPORT_NECK_LENGTH_MM,
		z: point.position.z + neckDirection.z * SUPPORT_NECK_LENGTH_MM
	};
}

export function supportContactEnd(point: ModelSurfaceHit): Point3 {
	const neckDirection = supportNeckDirection(point.normal);
	return {
		x: point.position.x - neckDirection.x * SUPPORT_CONTACT_PENETRATION_MM,
		y: point.position.y - neckDirection.y * SUPPORT_CONTACT_PENETRATION_MM,
		z: point.position.z - neckDirection.z * SUPPORT_CONTACT_PENETRATION_MM
	};
}

/** Where a plate-anchored post meets the plate, used to cluster feet into rafts. */
export function supportFootCenter(point: ModelSurfaceHit): Point3 {
	const neckBase = supportNeckBase(point);
	return { x: neckBase.x, y: neckBase.y, z: 0 };
}

export function doesModelProjectionOverlapSupportMargin(bounds: Bounds3): boolean {
	return (
		bounds.min.x < SUPPORT_PLATE_EDGE_MARGIN_MM + SUPPORT_GEOMETRY_EPSILON_MM ||
		bounds.max.x > BUILD_VOLUME.x - SUPPORT_PLATE_EDGE_MARGIN_MM - SUPPORT_GEOMETRY_EPSILON_MM ||
		bounds.min.y < SUPPORT_PLATE_EDGE_MARGIN_MM + SUPPORT_GEOMETRY_EPSILON_MM ||
		bounds.max.y > BUILD_VOLUME.y - SUPPORT_PLATE_EDGE_MARGIN_MM - SUPPORT_GEOMETRY_EPSILON_MM
	);
}

export function isSupportFootInsideBuildPlate(point: ModelSurfaceHit): boolean {
	if (point.lowerContactPosition) return true;

	const center = supportNeckBase(point);
	const radius = SUPPORT_FOOT_DIAMETER_MM / 2;
	return (
		center.x - radius >= -SUPPORT_GEOMETRY_EPSILON_MM &&
		center.x + radius <= BUILD_VOLUME.x + SUPPORT_GEOMETRY_EPSILON_MM &&
		center.y - radius >= -SUPPORT_GEOMETRY_EPSILON_MM &&
		center.y + radius <= BUILD_VOLUME.y + SUPPORT_GEOMETRY_EPSILON_MM
	);
}

export function createPostSupportStructure(
	point: SupportPoint,
	raftBaseZMm = 0
): SupportStructure | null {
	const neckBase = supportNeckBase(point);

	if (point.lowerContactPosition) {
		const lowerContactStart = {
			x: point.lowerContactPosition.x,
			y: point.lowerContactPosition.y,
			z: point.lowerContactPosition.z - SUPPORT_CONTACT_PENETRATION_MM
		};
		const lowerNeckBase = {
			x: point.lowerContactPosition.x,
			y: point.lowerContactPosition.y,
			z: point.lowerContactPosition.z + SUPPORT_NECK_LENGTH_MM
		};
		if (lowerNeckBase.z >= neckBase.z - SUPPORT_GEOMETRY_EPSILON_MM) return null;

		return {
			id: `post:${point.id}`,
			pointIds: [point.id],
			parts: [
				{
					kind: 'neck',
					start: lowerContactStart,
					end: lowerNeckBase,
					startDiameter: SUPPORT_CONTACT_DIAMETER_MM,
					endDiameter: SUPPORT_NECK_DIAMETER_MM
				},
				{
					kind: 'junction',
					center: { ...lowerNeckBase },
					diameter: SUPPORT_JUNCTION_DIAMETER_MM
				},
				{
					kind: 'shaft',
					start: { ...lowerNeckBase },
					end: { ...neckBase },
					startDiameter: SUPPORT_SHAFT_DIAMETER_MM,
					endDiameter: SUPPORT_SHAFT_DIAMETER_MM
				},
				{
					kind: 'junction',
					center: { ...neckBase },
					diameter: SUPPORT_JUNCTION_DIAMETER_MM
				},
				{
					kind: 'neck',
					start: { ...neckBase },
					end: supportContactEnd(point),
					startDiameter: SUPPORT_NECK_DIAMETER_MM,
					endDiameter: SUPPORT_CONTACT_DIAMETER_MM
				}
			]
		};
	}

	if (!isSupportFootInsideBuildPlate(point)) return null;

	// On a raft the flared foot is dropped: the raft slab is the plate contact and
	// the shaft rises straight from its top surface.
	if (raftBaseZMm > SUPPORT_GEOMETRY_EPSILON_MM) {
		if (neckBase.z <= raftBaseZMm + SUPPORT_GEOMETRY_EPSILON_MM) return null;
		return {
			id: `post:${point.id}`,
			pointIds: [point.id],
			parts: [
				{
					kind: 'shaft',
					start: { x: neckBase.x, y: neckBase.y, z: raftBaseZMm },
					end: { ...neckBase },
					startDiameter: SUPPORT_SHAFT_DIAMETER_MM,
					endDiameter: SUPPORT_SHAFT_DIAMETER_MM
				},
				{
					kind: 'junction',
					center: { ...neckBase },
					diameter: SUPPORT_JUNCTION_DIAMETER_MM
				},
				{
					kind: 'neck',
					start: { ...neckBase },
					end: supportContactEnd(point),
					startDiameter: SUPPORT_NECK_DIAMETER_MM,
					endDiameter: SUPPORT_CONTACT_DIAMETER_MM
				}
			]
		};
	}

	if (neckBase.z <= SUPPORT_FOOT_HEIGHT_MM + SUPPORT_GEOMETRY_EPSILON_MM) return null;

	return {
		id: `post:${point.id}`,
		pointIds: [point.id],
		parts: [
			{
				kind: 'foot',
				start: { x: neckBase.x, y: neckBase.y, z: 0 },
				end: { x: neckBase.x, y: neckBase.y, z: SUPPORT_FOOT_HEIGHT_MM },
				startDiameter: SUPPORT_FOOT_DIAMETER_MM,
				endDiameter: SUPPORT_SHAFT_DIAMETER_MM
			},
			{
				kind: 'shaft',
				start: { x: neckBase.x, y: neckBase.y, z: SUPPORT_FOOT_HEIGHT_MM },
				end: { ...neckBase },
				startDiameter: SUPPORT_SHAFT_DIAMETER_MM,
				endDiameter: SUPPORT_SHAFT_DIAMETER_MM
			},
			{
				kind: 'junction',
				center: { ...neckBase },
				diameter: SUPPORT_JUNCTION_DIAMETER_MM
			},
			{
				kind: 'neck',
				start: { ...neckBase },
				end: supportContactEnd(point),
				startDiameter: SUPPORT_NECK_DIAMETER_MM,
				endDiameter: SUPPORT_CONTACT_DIAMETER_MM
			}
		]
	};
}

export function generateSupportPlan(
	points: readonly SupportPoint[],
	raftedSupportPointIds: ReadonlySet<string> = new Set()
): SupportPlan {
	const structures: SupportStructure[] = [];
	const unresolvedPoints: UnresolvedSupportPoint[] = [];

	for (const point of points) {
		const raftBaseZMm = raftedSupportPointIds.has(point.id) ? RAFT_CORE_HEIGHT_MM : 0;
		const structure = createPostSupportStructure(point, raftBaseZMm);
		if (structure) {
			structures.push(structure);
		} else {
			unresolvedPoints.push({
				pointId: point.id,
				reason: isSupportFootInsideBuildPlate(point) ? 'insufficient-height' : 'outside-build-plate'
			});
		}
	}

	return { structures, unresolvedPoints };
}
