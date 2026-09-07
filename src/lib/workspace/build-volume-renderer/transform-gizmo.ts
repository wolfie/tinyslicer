import {
	BufferGeometry,
	CanvasTexture,
	CylinderGeometry,
	DoubleSide,
	Group,
	LineBasicMaterial,
	LineSegments,
	Material,
	Mesh,
	MeshBasicMaterial,
	PerspectiveCamera,
	PlaneGeometry,
	Quaternion,
	RingGeometry,
	Scene,
	SphereGeometry,
	SRGBColorSpace,
	Vector3
} from 'three';

import type { ImportedStlModel } from '../stl-importer';
import { transformModelBounds, transformModelPoint } from './model-transform';
import type {
	BuildVolumeInteractionMode,
	ModelRotation,
	ModelScale,
	ModelTranslation
} from './types';

const ARROW_OUTSET = 3;
const ARROW_LENGTH = 10;
const ARROW_WIDTH = 4.5;
const ARROW_OPACITY = 0.68;
const ARROW_CROSSFADE_START = Math.PI / 6;
const ARROW_CROSSFADE_MIDPOINT = Math.PI / 4;
const ARROW_CROSSFADE_END = Math.PI / 3;
const ROTATION_RING_INNER_RADIUS = 0.972;
const ROTATION_RING_OUTER_RADIUS = 1;
const ROTATION_RING_SEGMENTS = 96;
const SCALE_HANDLE_RADIUS = 0.8;
const BOX_EDGES: readonly [number, number][] = [
	[0, 1],
	[0, 2],
	[0, 4],
	[1, 3],
	[1, 5],
	[2, 3],
	[2, 6],
	[3, 7],
	[4, 5],
	[4, 6],
	[5, 7],
	[6, 7]
];

export type TranslationDirection = {
	axis: keyof ModelTranslation;
	sign: -1 | 1;
	vector: Vector3;
	color: number;
};

export type RotationAxis = {
	axis: keyof ModelTranslation;
	vector: Vector3;
	color: number;
};

type TranslationArrowPlane = Mesh<PlaneGeometry, MeshBasicMaterial>;

type TranslationArrow = {
	direction: TranslationDirection;
	group: Group;
	planes: [TranslationArrowPlane, TranslationArrowPlane];
	normals: [Vector3, Vector3];
};

type RotationRing = {
	axis: RotationAxis;
	group: Group;
	material: MeshBasicMaterial;
	hitTarget: Mesh<RingGeometry, MeshBasicMaterial>;
};

const TRANSLATION_DIRECTIONS: TranslationDirection[] = [
	{ axis: 'x', sign: 1, vector: new Vector3(1, 0, 0), color: 0xff777b },
	{ axis: 'x', sign: -1, vector: new Vector3(-1, 0, 0), color: 0xff777b },
	{ axis: 'y', sign: 1, vector: new Vector3(0, 1, 0), color: 0x72e7ac },
	{ axis: 'y', sign: -1, vector: new Vector3(0, -1, 0), color: 0x72e7ac },
	{ axis: 'z', sign: 1, vector: new Vector3(0, 0, 1), color: 0x75bdff },
	{ axis: 'z', sign: -1, vector: new Vector3(0, 0, -1), color: 0x75bdff }
];

const ROTATION_AXES: RotationAxis[] = [
	{ axis: 'x', vector: new Vector3(1, 0, 0), color: 0xff777b },
	{ axis: 'y', vector: new Vector3(0, 1, 0), color: 0x72e7ac },
	{ axis: 'z', vector: new Vector3(0, 0, 1), color: 0x75bdff }
];

function smoothstep(start: number, end: number, value: number): number {
	const progress = Math.max(0, Math.min(1, (value - start) / (end - start)));
	return progress * progress * (3 - 2 * progress);
}

export function translationArrowPlaneWeights(
	firstPlaneFacing: number,
	crossedPlaneFacing: number
): [number, number] {
	const viewingAngle = Math.atan2(Math.abs(crossedPlaneFacing), Math.abs(firstPlaneFacing));
	return [
		1 - smoothstep(ARROW_CROSSFADE_MIDPOINT, ARROW_CROSSFADE_END, viewingAngle),
		smoothstep(ARROW_CROSSFADE_START, ARROW_CROSSFADE_MIDPOINT, viewingAngle)
	];
}

export function createRotationRingGeometry(): CylinderGeometry {
	const radius = (ROTATION_RING_INNER_RADIUS + ROTATION_RING_OUTER_RADIUS) / 2;
	const width = ROTATION_RING_OUTER_RADIUS - ROTATION_RING_INNER_RADIUS;
	const geometry = new CylinderGeometry(radius, radius, width, ROTATION_RING_SEGMENTS, 1, true);
	geometry.rotateX(Math.PI / 2);
	return geometry;
}

export class TransformGizmo {
	readonly translationHitTargets: TranslationArrowPlane[] = [];
	readonly rotationHitTargets: Mesh<RingGeometry, MeshBasicMaterial>[] = [];
	readonly scaleHitTargets: Mesh<SphereGeometry, MeshBasicMaterial>[] = [];
	readonly scaleAnchor = new Vector3();

	#scene: Scene;
	#group = new Group();
	#translationArrows: TranslationArrow[] = [];
	#rotationRings: RotationRing[] = [];
	#scaleBoxGroup = new Group();
	#scaleBoxGeometry = new BufferGeometry();
	#scaleBoxMaterial = new LineBasicMaterial({
		color: 0x9bccec,
		transparent: true,
		opacity: 0.28,
		depthTest: false,
		depthWrite: false
	});
	#scaleBox = new LineSegments(this.#scaleBoxGeometry, this.#scaleBoxMaterial);
	#scaleGuideGeometry = new BufferGeometry();
	#scaleGuideMaterial = new LineBasicMaterial({
		color: 0xd8efff,
		transparent: true,
		opacity: 0.5,
		depthTest: false,
		depthWrite: false
	});
	#scaleGuide = new LineSegments(this.#scaleGuideGeometry, this.#scaleGuideMaterial);
	#scaleModel: ImportedStlModel | null = null;
	#arrowGeometry = new PlaneGeometry(ARROW_LENGTH, ARROW_WIDTH);
	#arrowTexture: CanvasTexture;

	constructor(scene: Scene) {
		this.#scene = scene;
		this.#arrowTexture = this.#createArrowTexture();
		this.#createTranslationArrows();
		this.#createRotationRings();
		this.#createScaleBox();
		this.#scene.add(this.#group);
	}

	visibleTranslationHitTargets(): TranslationArrowPlane[] {
		return this.translationHitTargets.filter((target) => target.visible);
	}

	update(options: {
		model: ImportedStlModel | null;
		translation: ModelTranslation;
		rotation: ModelRotation;
		scale: ModelScale;
		interactionMode: BuildVolumeInteractionMode;
		camera: PerspectiveCamera;
		modelCenter: Vector3;
		rotationRingRadius: number;
		activeRotationAxis: keyof ModelTranslation | null;
		activeScaleHandle: number | null;
	}) {
		this.#updateTranslationArrows(options);
		this.#updateRotationRings(options);
		this.#updateScaleBox(options);
	}

	hide() {
		for (const arrow of this.#translationArrows) arrow.group.visible = false;
		for (const ring of this.#rotationRings) ring.group.visible = false;
		this.#scaleBoxGroup.visible = false;
		for (const handle of this.scaleHitTargets) handle.visible = false;
		this.#scaleGuide.visible = false;
	}

	dispose() {
		const geometries = new Set<BufferGeometry>();
		const materials = new Set<Material>();
		this.#group.traverse((object) => {
			if (!(object instanceof Mesh)) return;
			geometries.add(object.geometry);
			const objectMaterials = Array.isArray(object.material) ? object.material : [object.material];
			for (const material of objectMaterials) materials.add(material);
		});
		for (const geometry of geometries) geometry.dispose();
		for (const material of materials) material.dispose();
		this.#arrowTexture.dispose();
		this.#scaleBoxGeometry.dispose();
		this.#scaleBoxMaterial.dispose();
		this.#scaleGuideGeometry.dispose();
		this.#scaleGuideMaterial.dispose();
		this.#scene.remove(this.#group);
		this.#group.clear();
	}

	#createScaleBox() {
		this.#scaleBox.renderOrder = 8;
		this.#scaleGuide.renderOrder = 12;
		this.#scaleGuide.visible = false;
		this.#scaleBoxGroup.add(this.#scaleBox);
		this.#group.add(this.#scaleBoxGroup, this.#scaleGuide);

		for (let index = 0; index < 4; index += 1) {
			const material = new MeshBasicMaterial({
				color: 0xd8efff,
				transparent: true,
				opacity: 0.8,
				depthTest: false,
				depthWrite: false
			});
			const handle = new Mesh(new SphereGeometry(SCALE_HANDLE_RADIUS, 16, 10), material);
			handle.userData.scaleHandleIndex = index;
			handle.renderOrder = 12;
			handle.visible = false;
			this.scaleHitTargets.push(handle);
			this.#group.add(handle);
		}
	}

	#refreshScaleBoxGeometry(model: ImportedStlModel) {
		if (model === this.#scaleModel) return;
		this.#scaleModel = model;
		const center = new Vector3(
			(model.bounds.min.x + model.bounds.max.x) / 2,
			(model.bounds.min.y + model.bounds.max.y) / 2,
			(model.bounds.min.z + model.bounds.max.z) / 2
		);
		const corners: Vector3[] = [];
		for (const z of [model.bounds.min.z, model.bounds.max.z]) {
			for (const y of [model.bounds.min.y, model.bounds.max.y]) {
				for (const x of [model.bounds.min.x, model.bounds.max.x]) {
					corners.push(new Vector3(x, y, z).sub(center));
				}
			}
		}
		const vertices: Vector3[] = [];
		for (const [from, to] of BOX_EDGES) vertices.push(corners[from], corners[to]);
		this.#scaleBoxGeometry.setFromPoints(vertices);
		this.#scaleBoxGeometry.computeBoundingSphere();
	}

	#updateScaleBox(options: {
		model: ImportedStlModel | null;
		translation: ModelTranslation;
		rotation: ModelRotation;
		scale: ModelScale;
		interactionMode: BuildVolumeInteractionMode;
		modelCenter: Vector3;
		activeScaleHandle: number | null;
	}) {
		if (!options.model || options.interactionMode !== 'transform-model') {
			this.#scaleBoxGroup.visible = false;
			for (const handle of this.scaleHitTargets) handle.visible = false;
			this.#scaleGuide.visible = false;
			return;
		}
		this.#refreshScaleBoxGeometry(options.model);
		this.#scaleBoxGroup.position.copy(options.modelCenter);
		this.#scaleBoxGroup.quaternion.copy(
			new Quaternion(
				options.rotation.x,
				options.rotation.y,
				options.rotation.z,
				options.rotation.w
			).normalize()
		);
		this.#scaleBoxGroup.scale.setScalar(options.scale);
		this.#scaleBoxGroup.visible = true;

		this.scaleAnchor.set(
			(options.model.bounds.min.x + options.model.bounds.max.x) / 2 + options.translation.x,
			(options.model.bounds.min.y + options.model.bounds.max.y) / 2 + options.translation.y,
			options.model.bounds.min.z + options.translation.z
		);
		const signs: readonly [number, number][] = [
			[-1, -1],
			[1, -1],
			[-1, 1],
			[1, 1]
		];
		for (let index = 0; index < this.scaleHitTargets.length; index += 1) {
			const [xSign, ySign] = signs[index];
			const handle = this.scaleHitTargets[index];
			handle.position.copy(
				transformModelPoint(
					{
						x: xSign < 0 ? options.model.bounds.min.x : options.model.bounds.max.x,
						y: ySign < 0 ? options.model.bounds.min.y : options.model.bounds.max.y,
						z: options.model.bounds.max.z
					},
					options.model.bounds,
					options.translation,
					options.rotation,
					options.scale
				)
			);
			handle.visible = true;
			handle.material.opacity = options.activeScaleHandle === index ? 1 : 0.72;
		}

		if (options.activeScaleHandle === null) {
			this.#scaleGuide.visible = false;
		} else {
			this.#scaleGuideGeometry.setFromPoints([
				this.scaleAnchor,
				this.scaleHitTargets[options.activeScaleHandle].position
			]);
			this.#scaleGuideGeometry.computeBoundingSphere();
			this.#scaleGuide.visible = true;
		}
	}

	#createArrowTexture(): CanvasTexture {
		const canvas = document.createElement('canvas');
		canvas.width = 128;
		canvas.height = 64;
		const context = canvas.getContext('2d');
		if (context) {
			context.fillStyle = '#ffffff';
			context.strokeStyle = 'rgba(4, 12, 20, 0.85)';
			context.lineWidth = 5;
			context.lineJoin = 'round';
			context.beginPath();
			context.moveTo(8, 23);
			context.lineTo(76, 23);
			context.lineTo(76, 9);
			context.lineTo(120, 32);
			context.lineTo(76, 55);
			context.lineTo(76, 41);
			context.lineTo(8, 41);
			context.closePath();
			context.stroke();
			context.fill();
		}
		const texture = new CanvasTexture(canvas);
		texture.colorSpace = SRGBColorSpace;
		return texture;
	}

	#createTranslationArrows() {
		for (const direction of TRANSLATION_DIRECTIONS) {
			const createMaterial = () =>
				new MeshBasicMaterial({
					map: this.#arrowTexture,
					color: direction.color,
					depthTest: false,
					depthWrite: false,
					opacity: ARROW_OPACITY,
					side: DoubleSide,
					transparent: true
				});
			const firstPlane = new Mesh(this.#arrowGeometry, createMaterial()) as TranslationArrowPlane;
			const crossedPlane = new Mesh(this.#arrowGeometry, createMaterial()) as TranslationArrowPlane;
			crossedPlane.rotation.x = Math.PI / 2;

			for (const plane of [firstPlane, crossedPlane]) {
				plane.renderOrder = 10;
				plane.userData.direction = direction;
				this.translationHitTargets.push(plane);
			}

			const group = new Group();
			group.add(firstPlane, crossedPlane);
			group.quaternion.setFromUnitVectors(new Vector3(1, 0, 0), direction.vector);
			group.visible = false;
			this.#translationArrows.push({
				direction,
				group,
				planes: [firstPlane, crossedPlane],
				normals: [
					new Vector3(0, 0, 1).applyQuaternion(group.quaternion),
					new Vector3(0, -1, 0).applyQuaternion(group.quaternion)
				]
			});
			this.#group.add(group);
		}
	}

	#createRotationRings() {
		for (const axis of ROTATION_AXES) {
			const material = new MeshBasicMaterial({
				color: axis.color,
				depthTest: false,
				depthWrite: false,
				opacity: 0.76,
				side: DoubleSide,
				transparent: true
			});
			const ring = new Mesh(createRotationRingGeometry(), material);
			const hitMaterial = new MeshBasicMaterial({
				colorWrite: false,
				depthWrite: false,
				opacity: 0,
				side: DoubleSide,
				transparent: true
			});
			const hitTarget = new Mesh(new RingGeometry(0.91, 1.06, ROTATION_RING_SEGMENTS), hitMaterial);
			hitTarget.userData.axis = axis;
			ring.renderOrder = 11;
			hitTarget.renderOrder = 11;

			const group = new Group();
			group.add(ring, hitTarget);
			group.quaternion.setFromUnitVectors(new Vector3(0, 0, 1), axis.vector);
			group.visible = false;
			this.#rotationRings.push({ axis, group, material, hitTarget });
			this.rotationHitTargets.push(hitTarget);
			this.#group.add(group);
		}
	}

	#updateTranslationArrows(options: {
		model: ImportedStlModel | null;
		translation: ModelTranslation;
		rotation: ModelRotation;
		scale: ModelScale;
		interactionMode: BuildVolumeInteractionMode;
		camera: PerspectiveCamera;
	}) {
		if (!options.model || options.interactionMode !== 'transform-model') {
			for (const arrow of this.#translationArrows) arrow.group.visible = false;
			return;
		}
		const bounds = transformModelBounds(
			options.model.bounds,
			options.translation,
			options.rotation,
			options.scale
		);
		const center = new Vector3(
			(bounds.min.x + bounds.max.x) / 2,
			(bounds.min.y + bounds.max.y) / 2,
			(bounds.min.z + bounds.max.z) / 2
		);
		const halfDimensions = new Vector3(
			(bounds.max.x - bounds.min.x) / 2,
			(bounds.max.y - bounds.min.y) / 2,
			(bounds.max.z - bounds.min.z) / 2
		);

		for (const arrow of this.#translationArrows) {
			const direction = arrow.direction.vector;
			const extent =
				Math.abs(direction.x) * halfDimensions.x +
				Math.abs(direction.y) * halfDimensions.y +
				Math.abs(direction.z) * halfDimensions.z;
			arrow.group.position.copy(center).addScaledVector(direction, extent + ARROW_OUTSET);
			arrow.group.visible = true;

			const viewDirection = options.camera.position.clone().sub(arrow.group.position).normalize();
			const [firstWeight, crossedWeight] = translationArrowPlaneWeights(
				viewDirection.dot(arrow.normals[0]),
				viewDirection.dot(arrow.normals[1])
			);
			arrow.planes[0].material.opacity = ARROW_OPACITY * firstWeight;
			arrow.planes[0].visible = firstWeight > 0;
			arrow.planes[1].material.opacity = ARROW_OPACITY * crossedWeight;
			arrow.planes[1].visible = crossedWeight > 0;
		}
	}

	#updateRotationRings(options: {
		model: ImportedStlModel | null;
		interactionMode: BuildVolumeInteractionMode;
		modelCenter: Vector3;
		rotationRingRadius: number;
		activeRotationAxis: keyof ModelTranslation | null;
	}) {
		if (!options.model || options.interactionMode !== 'transform-model') {
			for (const ring of this.#rotationRings) ring.group.visible = false;
			return;
		}
		for (const ring of this.#rotationRings) {
			ring.group.position.copy(options.modelCenter);
			ring.group.scale.setScalar(options.rotationRingRadius);
			ring.group.visible = true;
			ring.material.opacity = options.activeRotationAxis === ring.axis.axis ? 1 : 0.4;
		}
	}
}
