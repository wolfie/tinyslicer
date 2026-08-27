import { Vector3 } from 'three';

import { modelRotationQuaternion } from './build-volume-renderer/model-transform';
import type { ModelRotation, ModelTranslation } from './build-volume-renderer/types';
import type { ImportedStlModel } from './stl-importer';

export const SUPPORT_RISK_ANGLE_DEGREES = 45;

const DEGENERATE_TRIANGLE_EPSILON = 1e-12;
const BUILD_PLATE_CONTACT_TOLERANCE_MM = 1e-3;
const DOWN = new Vector3(0, 0, -1);

export type SupportRiskPreview = {
	positions: Float32Array;
	triangleCount: number;
};

/**
 * Builds a quick mesh-angle preview for support placement. This deliberately
 * does not claim to find slice islands or unsupported layer-mask growth.
 */
export function detectSupportRiskTriangles(
	model: Pick<ImportedStlModel, 'bounds' | 'positions' | 'normals'>,
	translation: ModelTranslation,
	rotation: ModelRotation,
	overhangAngleDegrees = SUPPORT_RISK_ANGLE_DEGREES
): SupportRiskPreview {
	const candidateOffsets: number[] = [];
	const center = new Vector3(
		(model.bounds.min.x + model.bounds.max.x) / 2,
		(model.bounds.min.y + model.bounds.max.y) / 2,
		(model.bounds.min.z + model.bounds.max.z) / 2
	);
	const quaternion = modelRotationQuaternion(rotation);
	const maximumNormalAngle = (overhangAngleDegrees * Math.PI) / 180;
	const minimumDownwardAlignment = Math.cos(maximumNormalAngle);
	const first = new Vector3();
	const second = new Vector3();
	const third = new Vector3();
	const faceNormal = new Vector3();
	const edgeA = new Vector3();
	const edgeB = new Vector3();
	const worldVertex = new Vector3();

	for (let offset = 0; offset + 8 < model.positions.length; offset += 9) {
		first.fromArray(model.positions, offset);
		second.fromArray(model.positions, offset + 3);
		third.fromArray(model.positions, offset + 6);

		faceNormal
			.fromArray(model.normals, offset)
			.add(edgeA.fromArray(model.normals, offset + 3))
			.add(edgeB.fromArray(model.normals, offset + 6));
		if (faceNormal.lengthSq() <= DEGENERATE_TRIANGLE_EPSILON) {
			faceNormal.crossVectors(edgeA.subVectors(second, first), edgeB.subVectors(third, first));
		}
		if (faceNormal.lengthSq() <= DEGENERATE_TRIANGLE_EPSILON) continue;

		faceNormal.normalize().applyQuaternion(quaternion);
		if (faceNormal.dot(DOWN) + Number.EPSILON < minimumDownwardAlignment) continue;

		let restsOnBuildPlate = true;
		for (let vertexOffset = 0; vertexOffset < 9; vertexOffset += 3) {
			worldVertex
				.fromArray(model.positions, offset + vertexOffset)
				.sub(center)
				.applyQuaternion(quaternion)
				.add(center);
			const worldZ = worldVertex.z + translation.z;
			if (Math.abs(worldZ) > BUILD_PLATE_CONTACT_TOLERANCE_MM) {
				restsOnBuildPlate = false;
				break;
			}
		}
		if (restsOnBuildPlate) continue;

		candidateOffsets.push(offset);
	}

	const positions = new Float32Array(candidateOffsets.length * 9);
	for (let candidateIndex = 0; candidateIndex < candidateOffsets.length; candidateIndex += 1) {
		const sourceOffset = candidateOffsets[candidateIndex];
		const targetOffset = candidateIndex * 9;
		for (let component = 0; component < 9; component += 1) {
			positions[targetOffset + component] = model.positions[sourceOffset + component];
		}
	}

	return {
		positions,
		triangleCount: candidateOffsets.length
	};
}
