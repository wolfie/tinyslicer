import { Euler, Quaternion, Vector3 } from 'three';

import { TINYMAKER_PROFILE } from '$lib/printer/tinymaker';
import type { Bounds3, ImportedStlModel, Point3 } from '../stl-importer';
import type { ModelRotation, ModelTranslation } from './types';

const BUILD_VOLUME = TINYMAKER_PROFILE.buildVolume;
const SMALL_TRANSLATION_STEP = 1;
const LARGE_TRANSLATION_STEP = 5;
const BUILD_VOLUME_BOUNDS_EPSILON = 1e-6;

export const ROTATION_SNAP_DEGREES = 22.5;
const ROTATION_SNAP_RADIANS = (ROTATION_SNAP_DEGREES * Math.PI) / 180;
export const ZERO_MODEL_TRANSLATION: ModelTranslation = { x: 0, y: 0, z: 0 };
export const IDENTITY_MODEL_ROTATION: ModelRotation = { x: 0, y: 0, z: 0, w: 1 };

export function modelRotationQuaternion(rotation: ModelRotation): Quaternion {
	return new Quaternion(rotation.x, rotation.y, rotation.z, rotation.w).normalize();
}

export function nudgeModelTranslation(
	translation: ModelTranslation,
	axis: keyof ModelTranslation,
	sign: -1 | 1,
	largeStep = false
): ModelTranslation {
	const distance = largeStep ? LARGE_TRANSLATION_STEP : SMALL_TRANSLATION_STEP;
	return { ...translation, [axis]: translation[axis] + sign * distance };
}

export function snapRotationAngle(angle: number, freeRotation = false): number {
	return freeRotation ? angle : Math.round(angle / ROTATION_SNAP_RADIANS) * ROTATION_SNAP_RADIANS;
}

export function signedRotationAngle(from: Vector3, to: Vector3, axis: Vector3): number {
	const normalizedAxis = axis.clone().normalize();
	const planarFrom = from.clone().addScaledVector(normalizedAxis, -from.dot(normalizedAxis));
	const planarTo = to.clone().addScaledVector(normalizedAxis, -to.dot(normalizedAxis));
	if (planarFrom.lengthSq() === 0 || planarTo.lengthSq() === 0) return 0;

	planarFrom.normalize();
	planarTo.normalize();
	return Math.atan2(
		normalizedAxis.dot(planarFrom.clone().cross(planarTo)),
		planarFrom.dot(planarTo)
	);
}

export function modelRotationDegrees(rotation: ModelRotation): ModelTranslation {
	const euler = new Euler().setFromQuaternion(modelRotationQuaternion(rotation), 'XYZ');
	const toDegrees = (radians: number) => (radians * 180) / Math.PI;
	return { x: toDegrees(euler.x), y: toDegrees(euler.y), z: toDegrees(euler.z) };
}

export function translateModelBounds(
	bounds: Bounds3,
	translation: ModelTranslation = ZERO_MODEL_TRANSLATION
): Bounds3 {
	return {
		min: {
			x: bounds.min.x + translation.x,
			y: bounds.min.y + translation.y,
			z: bounds.min.z + translation.z
		},
		max: {
			x: bounds.max.x + translation.x,
			y: bounds.max.y + translation.y,
			z: bounds.max.z + translation.z
		}
	};
}

export function transformModelBounds(
	bounds: Bounds3,
	translation: ModelTranslation = ZERO_MODEL_TRANSLATION,
	rotation: ModelRotation = IDENTITY_MODEL_ROTATION
): Bounds3 {
	const center = new Vector3(
		(bounds.min.x + bounds.max.x) / 2,
		(bounds.min.y + bounds.max.y) / 2,
		(bounds.min.z + bounds.max.z) / 2
	);
	const quaternion = modelRotationQuaternion(rotation);
	const transformedMin = new Vector3(Infinity, Infinity, Infinity);
	const transformedMax = new Vector3(-Infinity, -Infinity, -Infinity);

	for (const x of [bounds.min.x, bounds.max.x]) {
		for (const y of [bounds.min.y, bounds.max.y]) {
			for (const z of [bounds.min.z, bounds.max.z]) {
				const corner = new Vector3(x, y, z)
					.sub(center)
					.applyQuaternion(quaternion)
					.add(center)
					.add(new Vector3(translation.x, translation.y, translation.z));
				transformedMin.min(corner);
				transformedMax.max(corner);
			}
		}
	}

	return {
		min: { x: transformedMin.x, y: transformedMin.y, z: transformedMin.z },
		max: { x: transformedMax.x, y: transformedMax.y, z: transformedMax.z }
	};
}

export function transformModelGeometryBounds(
	model: Pick<ImportedStlModel, 'bounds' | 'positions'>,
	translation: ModelTranslation = ZERO_MODEL_TRANSLATION,
	rotation: ModelRotation = IDENTITY_MODEL_ROTATION
): Bounds3 {
	if (model.positions.length < 3) {
		return transformModelBounds(model.bounds, translation, rotation);
	}

	const center = new Vector3(
		(model.bounds.min.x + model.bounds.max.x) / 2,
		(model.bounds.min.y + model.bounds.max.y) / 2,
		(model.bounds.min.z + model.bounds.max.z) / 2
	);
	const quaternion = modelRotationQuaternion(rotation);
	const transformedMin = new Vector3(Infinity, Infinity, Infinity);
	const transformedMax = new Vector3(-Infinity, -Infinity, -Infinity);
	const vertex = new Vector3();

	for (let index = 0; index < model.positions.length; index += 3) {
		vertex
			.set(
				model.positions[index] - center.x,
				model.positions[index + 1] - center.y,
				model.positions[index + 2] - center.z
			)
			.applyQuaternion(quaternion)
			.add(center);
		transformedMin.min(vertex);
		transformedMax.max(vertex);
	}

	return translateModelBounds(
		{
			min: { x: transformedMin.x, y: transformedMin.y, z: transformedMin.z },
			max: { x: transformedMax.x, y: transformedMax.y, z: transformedMax.z }
		},
		translation
	);
}

export function areBoundsOutsideBuildVolume(bounds: Bounds3): boolean {
	return firstBuildVolumeOverflowDirection(bounds) !== null;
}

export function firstBuildVolumeOverflowDirection(bounds: Bounds3): Point3 | null {
	if (bounds.min.x < -BUILD_VOLUME_BOUNDS_EPSILON) return { x: -1, y: 0, z: 0 };
	if (bounds.max.x > BUILD_VOLUME.x + BUILD_VOLUME_BOUNDS_EPSILON) return { x: 1, y: 0, z: 0 };
	if (bounds.min.y < -BUILD_VOLUME_BOUNDS_EPSILON) return { x: 0, y: -1, z: 0 };
	if (bounds.max.y > BUILD_VOLUME.y + BUILD_VOLUME_BOUNDS_EPSILON) return { x: 0, y: 1, z: 0 };
	if (bounds.min.z < -BUILD_VOLUME_BOUNDS_EPSILON) return { x: 0, y: 0, z: -1 };
	if (bounds.max.z > BUILD_VOLUME.z + BUILD_VOLUME_BOUNDS_EPSILON) return { x: 0, y: 0, z: 1 };
	return null;
}

export function isModelOutsideBuildVolume(
	model: ImportedStlModel,
	translation: ModelTranslation = ZERO_MODEL_TRANSLATION,
	rotation: ModelRotation = IDENTITY_MODEL_ROTATION
): boolean {
	return areBoundsOutsideBuildVolume(transformModelGeometryBounds(model, translation, rotation));
}

// Candidate spins around Z, tried in this order: no rotation first, then the
// remaining cardinal turns, then the finer 22.5 degree increments.
const IN_BOUNDS_Z_ROTATION_SEARCH_DEGREES = [
	0, 90, 180, 270, 22.5, 45, 67.5, 112.5, 135, 157.5, 202.5, 225, 247.5, 292.5, 315, 337.5
];

/**
 * Looks for a rotation around the vertical axis that brings a freshly imported
 * model fully inside the build volume. Only the XY footprint changes, so this
 * cannot rescue a model that is simply too tall. Returns the identity rotation
 * when nothing fits (or when the model already fits without rotating).
 */
export function findInBoundsZRotation(
	model: Pick<ImportedStlModel, 'bounds' | 'positions'>
): ModelRotation {
	const axis = new Vector3(0, 0, 1);
	for (const degrees of IN_BOUNDS_Z_ROTATION_SEARCH_DEGREES) {
		const quaternion = new Quaternion().setFromAxisAngle(axis, (degrees * Math.PI) / 180);
		const rotation: ModelRotation = {
			x: quaternion.x,
			y: quaternion.y,
			z: quaternion.z,
			w: quaternion.w
		};
		if (!areBoundsOutsideBuildVolume(transformModelGeometryBounds(model, undefined, rotation))) {
			return rotation;
		}
	}
	return { ...IDENTITY_MODEL_ROTATION };
}
