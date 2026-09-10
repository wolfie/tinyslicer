import { Mesh, Raycaster, Vector3 } from 'three';

import { triangleIntersectsVerticalCylinder } from '$lib/supports/support-collision';
import type { Point3 } from '../stl-importer';
import {
	createPostSupportStructure,
	supportNeckBase,
	type ModelSurfaceHit,
	type SupportFrustumPart,
	type SupportStructure
} from '../supports';

const SUPPORT_RAY_ORIGIN_OFFSET_MM = 1e-4;

export function findModelSurfaceBelow(modelMesh: Mesh, origin: Point3): Point3 | null {
	if (origin.z <= SUPPORT_RAY_ORIGIN_OFFSET_MM) return null;

	modelMesh.updateWorldMatrix(true, false);
	const rayOrigin = new Vector3(origin.x, origin.y, origin.z - SUPPORT_RAY_ORIGIN_OFFSET_MM);
	const raycaster = new Raycaster(
		rayOrigin,
		new Vector3(0, 0, -1),
		0,
		rayOrigin.z + SUPPORT_RAY_ORIGIN_OFFSET_MM
	);
	const hit = raycaster.intersectObject(modelMesh, false)[0];
	return hit ? { x: hit.point.x, y: hit.point.y, z: hit.point.z } : null;
}

function shaftCollidesWithMesh(modelMesh: Mesh, structure: SupportStructure): boolean {
	const shafts = structure.parts.filter(
		(part): part is SupportFrustumPart => part.kind === 'shaft'
	);
	if (shafts.length === 0) return false;

	modelMesh.updateWorldMatrix(true, false);
	const positions = modelMesh.geometry.getAttribute('position');
	const index = modelMesh.geometry.getIndex();
	const a = new Vector3();
	const b = new Vector3();
	const c = new Vector3();
	const vertex = (vertexIndex: number, target: Vector3) =>
		target.fromBufferAttribute(positions, vertexIndex).applyMatrix4(modelMesh.matrixWorld);
	const triangleCount = index ? index.count / 3 : positions.count / 3;

	for (let triangleIndex = 0; triangleIndex < triangleCount; triangleIndex += 1) {
		const offset = triangleIndex * 3;
		vertex(index ? index.getX(offset) : offset, a);
		vertex(index ? index.getX(offset + 1) : offset + 1, b);
		vertex(index ? index.getX(offset + 2) : offset + 2, c);
		for (const shaft of shafts) {
			if (
				triangleIntersectsVerticalCylinder(a, b, c, {
					x: shaft.start.x,
					y: shaft.start.y,
					minimumZMm: shaft.start.z,
					maximumZMm: shaft.end.z,
					radiusMm: Math.max(shaft.startDiameter, shaft.endDiameter) / 2
				})
			) {
				return true;
			}
		}
	}
	return false;
}

export function pickSupportSurface(modelMesh: Mesh, raycaster: Raycaster): ModelSurfaceHit | null {
	const hit = raycaster.intersectObject(modelMesh, false)[0];
	if (!hit) return null;

	const normal = hit.face?.normal.clone() ?? new Vector3(0, 0, 1);
	normal.transformDirection(modelMesh.matrixWorld).normalize();
	const surfaceHit: ModelSurfaceHit = {
		position: { x: hit.point.x, y: hit.point.y, z: hit.point.z },
		normal: { x: normal.x, y: normal.y, z: normal.z }
	};
	const lowerContactPosition = findModelSurfaceBelow(modelMesh, supportNeckBase(surfaceHit));
	const candidate = lowerContactPosition ? { ...surfaceHit, lowerContactPosition } : surfaceHit;
	const structure = createPostSupportStructure({ id: 'collision-probe', ...candidate });
	return structure && shaftCollidesWithMesh(modelMesh, structure) ? null : candidate;
}
