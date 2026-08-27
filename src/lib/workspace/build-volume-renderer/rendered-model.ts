import {
	BufferAttribute,
	BufferGeometry,
	DoubleSide,
	Mesh,
	MeshBasicMaterial,
	MeshStandardMaterial,
	Scene,
	Vector3
} from 'three';

import type { ImportedStlModel } from '../stl-importer';
import { detectSupportRiskTriangles } from '../support-risk';
import { createBuildVolumeClippingPlanes } from './build-volume-scene';
import {
	IDENTITY_MODEL_ROTATION,
	modelRotationQuaternion,
	ZERO_MODEL_TRANSLATION
} from './model-transform';
import type { ModelRotation, ModelTranslation } from './types';

const ROTATION_RING_GAP = 2.5;
const MIN_ROTATION_RING_RADIUS = 5;

export class RenderedModel {
	readonly center = new Vector3();
	rotationRingRadius = MIN_ROTATION_RING_RADIUS;
	currentModel: ImportedStlModel | null = null;
	currentTranslation: ModelTranslation = ZERO_MODEL_TRANSLATION;
	currentRotation: ModelRotation = IDENTITY_MODEL_ROTATION;

	#scene: Scene;
	#modelMaterial = new MeshStandardMaterial({
		color: 0x62b7ed,
		roughness: 0.62,
		metalness: 0.04,
		side: DoubleSide,
		clippingPlanes: createBuildVolumeClippingPlanes('inside')
	});
	#outsideModelMaterial = new MeshStandardMaterial({
		color: 0xffc84a,
		roughness: 0.62,
		metalness: 0.04,
		side: DoubleSide,
		clippingPlanes: createBuildVolumeClippingPlanes('outside'),
		clipIntersection: true
	});
	#supportRiskMaterial = new MeshBasicMaterial({
		color: 0xffd34f,
		transparent: true,
		opacity: 0.9,
		side: DoubleSide,
		depthWrite: false,
		polygonOffset: true,
		polygonOffsetFactor: -1,
		polygonOffsetUnits: -1,
		clippingPlanes: createBuildVolumeClippingPlanes('inside')
	});
	#modelMesh: Mesh | null = null;
	#outsideModelMesh: Mesh | null = null;
	#supportRiskMesh: Mesh | null = null;
	#supportRiskGeometryDirty = false;

	constructor(scene: Scene) {
		this.#scene = scene;
	}

	get mesh(): Mesh | null {
		return this.#modelMesh;
	}

	get worldCenter(): Vector3 {
		return this.center
			.clone()
			.add(
				new Vector3(this.currentTranslation.x, this.currentTranslation.y, this.currentTranslation.z)
			);
	}

	setModel(model: ImportedStlModel | null): boolean {
		if (model === this.currentModel) return false;
		this.currentModel = model;
		this.#removeMeshes();
		if (!model) return true;
		this.#supportRiskGeometryDirty = true;

		this.center.set(
			(model.bounds.min.x + model.bounds.max.x) / 2,
			(model.bounds.min.y + model.bounds.max.y) / 2,
			(model.bounds.min.z + model.bounds.max.z) / 2
		);
		const halfDimensions = new Vector3(
			(model.bounds.max.x - model.bounds.min.x) / 2,
			(model.bounds.max.y - model.bounds.min.y) / 2,
			(model.bounds.max.z - model.bounds.min.z) / 2
		);
		this.rotationRingRadius = Math.max(
			MIN_ROTATION_RING_RADIUS,
			halfDimensions.length() + ROTATION_RING_GAP
		);

		const geometry = new BufferGeometry();
		geometry.setAttribute('position', new BufferAttribute(model.positions.slice(), 3));
		geometry.setAttribute('normal', new BufferAttribute(model.normals, 3));
		geometry.translate(-this.center.x, -this.center.y, -this.center.z);
		geometry.computeBoundingSphere();

		this.#modelMesh = new Mesh(geometry, this.#modelMaterial);
		this.#modelMesh.renderOrder = 1;
		this.#outsideModelMesh = new Mesh(geometry, this.#outsideModelMaterial);
		this.#outsideModelMesh.renderOrder = 2;
		this.#supportRiskMesh = new Mesh(new BufferGeometry(), this.#supportRiskMaterial);
		this.#supportRiskMesh.renderOrder = 3;
		this.#supportRiskMesh.visible = false;
		this.#scene.add(this.#modelMesh, this.#outsideModelMesh, this.#supportRiskMesh);
		return true;
	}

	setTransform(translation: ModelTranslation, rotation: ModelRotation) {
		this.#supportRiskGeometryDirty =
			this.#supportRiskGeometryDirty ||
			translation.z !== this.currentTranslation.z ||
			rotation.x !== this.currentRotation.x ||
			rotation.y !== this.currentRotation.y ||
			rotation.z !== this.currentRotation.z ||
			rotation.w !== this.currentRotation.w;
		this.currentTranslation = translation;
		this.currentRotation = rotation;
		const quaternion = modelRotationQuaternion(rotation);
		const position = this.worldCenter;
		if (this.#modelMesh) {
			this.#modelMesh.position.copy(position);
			this.#modelMesh.quaternion.copy(quaternion);
		}
		if (this.#outsideModelMesh) {
			this.#outsideModelMesh.position.copy(position);
			this.#outsideModelMesh.quaternion.copy(quaternion);
		}
		if (this.#supportRiskMesh) {
			this.#supportRiskMesh.position.copy(position);
			this.#supportRiskMesh.quaternion.copy(quaternion);
		}
		if (this.#supportRiskMesh?.visible && this.#supportRiskGeometryDirty) {
			this.#refreshSupportRiskGeometry();
		}
	}

	setSupportRiskVisible(visible: boolean) {
		if (!this.#supportRiskMesh) return;
		this.#supportRiskMesh.visible = visible;
		if (visible && this.#supportRiskGeometryDirty) this.#refreshSupportRiskGeometry();
	}

	dispose() {
		this.#removeMeshes();
		this.#modelMaterial.dispose();
		this.#outsideModelMaterial.dispose();
		this.#supportRiskMaterial.dispose();
	}

	#refreshSupportRiskGeometry() {
		this.#supportRiskGeometryDirty = false;
		if (!this.currentModel || !this.#supportRiskMesh) return;

		const preview = detectSupportRiskTriangles(
			this.currentModel,
			this.currentTranslation,
			this.currentRotation
		);
		const geometry = new BufferGeometry();
		geometry.setAttribute('position', new BufferAttribute(preview.positions, 3));
		geometry.translate(-this.center.x, -this.center.y, -this.center.z);
		this.#supportRiskMesh.geometry.dispose();
		this.#supportRiskMesh.geometry = geometry;
	}

	#removeMeshes() {
		if (this.#modelMesh) {
			this.#scene.remove(this.#modelMesh);
			this.#modelMesh.geometry.dispose();
			this.#modelMesh = null;
		}
		if (this.#outsideModelMesh) {
			this.#scene.remove(this.#outsideModelMesh);
			this.#outsideModelMesh = null;
		}
		if (this.#supportRiskMesh) {
			this.#scene.remove(this.#supportRiskMesh);
			this.#supportRiskMesh.geometry.dispose();
			this.#supportRiskMesh = null;
		}
	}
}
