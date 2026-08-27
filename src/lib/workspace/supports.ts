import type { Point3 } from './stl-importer';

export const SUPPORT_SHAFT_DIAMETER_MM = 1.275;
export const SUPPORT_FOOT_DIAMETER_MM = 4;
export const SUPPORT_NECK_LENGTH_MM = 1.5;
export const SUPPORT_NECK_DIAMETER_MM = 0.8;
export const SUPPORT_CONTACT_DIAMETER_MM = 0.4;
export const SUPPORT_JUNCTION_DIAMETER_MM = SUPPORT_SHAFT_DIAMETER_MM;
export const SUPPORT_MAX_NECK_ANGLE_DEGREES = 45;
export const SUPPORT_FOOT_FLARE_ANGLE_DEGREES = 45;
export const SUPPORT_FOOT_HEIGHT_MM =
	((SUPPORT_FOOT_DIAMETER_MM - SUPPORT_SHAFT_DIAMETER_MM) / 2) *
	Math.tan((SUPPORT_FOOT_FLARE_ANGLE_DEGREES * Math.PI) / 180);

const SUPPORT_GEOMETRY_EPSILON_MM = 1e-6;

export type ModelSurfaceHit = {
	position: Point3;
	normal: Point3;
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
	reason: 'insufficient-height';
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

export function createPostSupportStructure(point: SupportPoint): SupportStructure | null {
	const neckDirection = supportNeckDirection(point.normal);
	const neckBase = {
		x: point.position.x + neckDirection.x * SUPPORT_NECK_LENGTH_MM,
		y: point.position.y + neckDirection.y * SUPPORT_NECK_LENGTH_MM,
		z: point.position.z + neckDirection.z * SUPPORT_NECK_LENGTH_MM
	};

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
				end: { ...point.position },
				startDiameter: SUPPORT_NECK_DIAMETER_MM,
				endDiameter: SUPPORT_CONTACT_DIAMETER_MM
			}
		]
	};
}

export function generateSupportPlan(points: readonly SupportPoint[]): SupportPlan {
	const structures: SupportStructure[] = [];
	const unresolvedPoints: UnresolvedSupportPoint[] = [];

	for (const point of points) {
		const structure = createPostSupportStructure(point);
		if (structure) {
			structures.push(structure);
		} else {
			unresolvedPoints.push({ pointId: point.id, reason: 'insufficient-height' });
		}
	}

	return { structures, unresolvedPoints };
}
