import { Mesh, Raycaster, Vector3 } from 'three';

import type { Point3 } from '../stl-importer';
import { supportNeckBase, type ModelSurfaceHit } from '../supports';

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
	return lowerContactPosition ? { ...surfaceHit, lowerContactPosition } : surfaceHit;
}
