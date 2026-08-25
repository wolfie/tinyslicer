import {
	ArrowHelper,
	BufferAttribute,
	BufferGeometry,
	CanvasTexture,
	CylinderGeometry,
	DirectionalLight,
	DoubleSide,
	Euler,
	Float32BufferAttribute,
	Group,
	HemisphereLight,
	Line,
	LineBasicMaterial,
	LineSegments,
	Material,
	Mesh,
	MeshBasicMaterial,
	MeshStandardMaterial,
	PerspectiveCamera,
	Plane,
	PlaneGeometry,
	Quaternion,
	Raycaster,
	RingGeometry,
	Scene,
	SphereGeometry,
	SRGBColorSpace,
	Vector2,
	Vector3,
	WebGLRenderer
} from 'three';

import { TINYMAKER_PROFILE } from '$lib/printer/tinymaker';
import type { Bounds3, ImportedStlModel, Point3 } from '$lib/workspace/stl-importer';

export type ModelTranslation = Point3;

export type ModelRotation = {
	x: number;
	y: number;
	z: number;
	w: number;
};

export type ModelInteraction =
	{ kind: 'translation' } | { kind: 'rotation'; axis: keyof ModelTranslation };

export type BuildVolumeRenderState = {
	cameraYaw: number;
	cameraPitch: number;
	width: number;
	height: number;
	dpr: number;
	model: ImportedStlModel | null;
	modelTranslation: ModelTranslation;
	modelRotation: ModelRotation;
};

const BUILD_VOLUME = TINYMAKER_PROFILE.buildVolume;
const CAMERA_TARGET = new Vector3(BUILD_VOLUME.x / 2, BUILD_VOLUME.y / 2, BUILD_VOLUME.z * 0.42);
const CAMERA_DISTANCE = 112;
const RULER_OFFSET = 0.8;
const RULER_MINOR_INTERVAL = 5;
const RULER_MAJOR_INTERVAL = 10;
const RULER_MINOR_TICK_LENGTH = 0.65;
const RULER_MAJOR_TICK_LENGTH = 1.2;
const ARROW_OUTSET = 3;
const ARROW_LENGTH = 10;
const ARROW_WIDTH = 4.5;
const ARROW_OPACITY = 0.68;
const ARROW_CROSSFADE_START = Math.PI / 6;
const ARROW_CROSSFADE_MIDPOINT = Math.PI / 4;
const ARROW_CROSSFADE_END = Math.PI / 3;
const SMALL_TRANSLATION_STEP = 1;
const LARGE_TRANSLATION_STEP = 5;
export const ROTATION_SNAP_DEGREES = 22.5;
const ROTATION_SNAP_RADIANS = (ROTATION_SNAP_DEGREES * Math.PI) / 180;
const ROTATION_RING_GAP = 2.5;
const MIN_ROTATION_RING_RADIUS = 5;
const ROTATION_RING_INNER_RADIUS = 0.972;
const ROTATION_RING_OUTER_RADIUS = 1;
const ROTATION_RING_SEGMENTS = 96;
const BUILD_VOLUME_BOUNDS_EPSILON = 1e-6;
const ZERO_TRANSLATION: ModelTranslation = { x: 0, y: 0, z: 0 };
export const IDENTITY_MODEL_ROTATION: ModelRotation = { x: 0, y: 0, z: 0, w: 1 };

type TranslationDirection = {
	axis: keyof ModelTranslation;
	sign: -1 | 1;
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

type RotationAxis = {
	axis: keyof ModelTranslation;
	vector: Vector3;
	color: number;
};

type RotationRing = {
	axis: RotationAxis;
	group: Group;
	material: MeshBasicMaterial;
	hitTarget: Mesh<RingGeometry, MeshBasicMaterial>;
};

type ActiveTranslationDrag = {
	kind: 'translation';
	pointerId: number;
	axis: 'xy' | 'z';
	plane: Plane;
	anchor: Vector3;
	initialTranslation: ModelTranslation;
	onChange: (translation: ModelTranslation) => void;
	onInteractionChange: (interaction: ModelInteraction | null) => void;
};

type ActiveRotationDrag = {
	kind: 'rotation';
	pointerId: number;
	axis: RotationAxis;
	plane: Plane;
	center: Vector3;
	previousRadial: Vector3;
	accumulatedAngle: number;
	initialRotation: Quaternion;
	onChange: (rotation: ModelRotation) => void;
	onInteractionChange: (interaction: ModelInteraction | null) => void;
};

type ActiveModelDrag = ActiveTranslationDrag | ActiveRotationDrag;

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

type ClippedRegion = 'inside' | 'outside';

export function createBuildVolumeClippingPlanes(region: ClippedRegion): Plane[] {
	const planes = [
		new Plane(new Vector3(1, 0, 0), 0),
		new Plane(new Vector3(-1, 0, 0), BUILD_VOLUME.x),
		new Plane(new Vector3(0, 1, 0), 0),
		new Plane(new Vector3(0, -1, 0), BUILD_VOLUME.y),
		new Plane(new Vector3(0, 0, 1), 0),
		new Plane(new Vector3(0, 0, -1), BUILD_VOLUME.z)
	];

	return region === 'inside' ? planes : planes.map((plane) => plane.negate());
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

export function translateModelBounds(
	bounds: Bounds3,
	translation: ModelTranslation = ZERO_TRANSLATION
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

function toQuaternion(rotation: ModelRotation): Quaternion {
	return new Quaternion(rotation.x, rotation.y, rotation.z, rotation.w).normalize();
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
	const euler = new Euler().setFromQuaternion(toQuaternion(rotation), 'XYZ');
	const toDegrees = (radians: number) => (radians * 180) / Math.PI;
	return { x: toDegrees(euler.x), y: toDegrees(euler.y), z: toDegrees(euler.z) };
}

export function createRotationRingGeometry(): CylinderGeometry {
	const radius = (ROTATION_RING_INNER_RADIUS + ROTATION_RING_OUTER_RADIUS) / 2;
	const width = ROTATION_RING_OUTER_RADIUS - ROTATION_RING_INNER_RADIUS;
	const geometry = new CylinderGeometry(radius, radius, width, ROTATION_RING_SEGMENTS, 1, true);
	geometry.rotateX(Math.PI / 2);
	return geometry;
}

export function transformModelBounds(
	bounds: Bounds3,
	translation: ModelTranslation = ZERO_TRANSLATION,
	rotation: ModelRotation = IDENTITY_MODEL_ROTATION
): Bounds3 {
	const center = new Vector3(
		(bounds.min.x + bounds.max.x) / 2,
		(bounds.min.y + bounds.max.y) / 2,
		(bounds.min.z + bounds.max.z) / 2
	);
	const quaternion = toQuaternion(rotation);
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
	translation: ModelTranslation = ZERO_TRANSLATION,
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
	const quaternion = toQuaternion(rotation);
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
	return (
		bounds.min.x < -BUILD_VOLUME_BOUNDS_EPSILON ||
		bounds.max.x > BUILD_VOLUME.x + BUILD_VOLUME_BOUNDS_EPSILON ||
		bounds.min.y < -BUILD_VOLUME_BOUNDS_EPSILON ||
		bounds.max.y > BUILD_VOLUME.y + BUILD_VOLUME_BOUNDS_EPSILON ||
		bounds.min.z < -BUILD_VOLUME_BOUNDS_EPSILON ||
		bounds.max.z > BUILD_VOLUME.z + BUILD_VOLUME_BOUNDS_EPSILON
	);
}

export function isModelOutsideBuildVolume(
	model: ImportedStlModel,
	translation: ModelTranslation = ZERO_TRANSLATION,
	rotation: ModelRotation = IDENTITY_MODEL_ROTATION
): boolean {
	return areBoundsOutsideBuildVolume(transformModelGeometryBounds(model, translation, rotation));
}

export function createMillimetreRulerVertices(
	origin: Vector3,
	direction: Vector3,
	tickDirection: Vector3,
	length: number
): number[] {
	const rulerDirection = direction.clone().normalize();
	const outwardDirection = tickDirection.clone().normalize();
	const rulerOrigin = origin.clone().addScaledVector(outwardDirection, RULER_OFFSET);
	const vertices = [
		rulerOrigin.x,
		rulerOrigin.y,
		rulerOrigin.z,
		rulerOrigin.x + rulerDirection.x * length,
		rulerOrigin.y + rulerDirection.y * length,
		rulerOrigin.z + rulerDirection.z * length
	];

	for (let distance = 0; distance <= length; distance += RULER_MINOR_INTERVAL) {
		const tickStart = rulerOrigin.clone().addScaledVector(rulerDirection, distance);
		const tickLength =
			distance % RULER_MAJOR_INTERVAL === 0 ? RULER_MAJOR_TICK_LENGTH : RULER_MINOR_TICK_LENGTH;
		const tickEnd = tickStart.clone().addScaledVector(outwardDirection, tickLength);
		vertices.push(tickStart.x, tickStart.y, tickStart.z, tickEnd.x, tickEnd.y, tickEnd.z);
	}

	return vertices;
}

class BuildVolumeViewport {
	#canvas: HTMLCanvasElement;
	#renderer: WebGLRenderer;
	#scene = new Scene();
	#camera = new PerspectiveCamera(36, 1, 0.1, 500);
	#raycaster = new Raycaster();
	#pointer = new Vector2();
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
	#modelMesh: Mesh | null = null;
	#outsideModelMesh: Mesh | null = null;
	#translationArrows: TranslationArrow[] = [];
	#translationArrowHitTargets: TranslationArrowPlane[] = [];
	#arrowGeometry = new PlaneGeometry(ARROW_LENGTH, ARROW_WIDTH);
	#arrowTexture: CanvasTexture;
	#rotationRings: RotationRing[] = [];
	#rotationRingHitTargets: Mesh<RingGeometry, MeshBasicMaterial>[] = [];
	#currentModel: ImportedStlModel | null = null;
	#currentTranslation: ModelTranslation = ZERO_TRANSLATION;
	#currentRotation: ModelRotation = IDENTITY_MODEL_ROTATION;
	#modelCenter = new Vector3();
	#rotationRingRadius = MIN_ROTATION_RING_RADIUS;
	#activeModelDrag: ActiveModelDrag | null = null;
	#pendingState: BuildVolumeRenderState | null = null;
	#animationFrame: number | null = null;
	#width = 0;
	#height = 0;
	#dpr = 0;

	constructor(canvas: HTMLCanvasElement) {
		this.#canvas = canvas;
		this.#renderer = new WebGLRenderer({
			canvas,
			alpha: true,
			antialias: true,
			powerPreference: 'high-performance'
		});
		this.#renderer.setClearColor(0x000000, 0);
		this.#renderer.outputColorSpace = SRGBColorSpace;
		this.#renderer.localClippingEnabled = true;
		this.#camera.up.set(0, 0, 1);
		this.#scene.add(this.#createBuildVolume());
		this.#arrowTexture = this.#createArrowTexture();
		this.#createTranslationArrows();
		this.#createRotationRings();
		this.#scene.add(new HemisphereLight(0xddeeff, 0x152536, 1.65));

		const keyLight = new DirectionalLight(0xffffff, 2.15);
		keyLight.position.set(-45, -55, 95);
		this.#scene.add(keyLight);

		const fillLight = new DirectionalLight(0x79bfff, 0.7);
		fillLight.position.set(70, 45, 35);
		this.#scene.add(fillLight);
	}

	startModelInteraction(
		event: PointerEvent,
		translation: ModelTranslation,
		rotation: ModelRotation,
		onTranslationChange: (translation: ModelTranslation) => void,
		onRotationChange: (rotation: ModelRotation) => void,
		onInteractionChange: (interaction: ModelInteraction | null) => void
	): boolean {
		if (event.button !== 0 || !this.#modelMesh) return false;
		this.#setPointer(event);

		const ringHit = this.#raycaster.intersectObjects(this.#rotationRingHitTargets, false)[0];
		if (ringHit) {
			const hitTarget = ringHit.object as Mesh<RingGeometry, MeshBasicMaterial>;
			const axis = hitTarget.userData.axis as RotationAxis;
			return this.#startRotationDrag(
				event,
				ringHit.point,
				axis,
				rotation,
				onRotationChange,
				onInteractionChange
			);
		}

		const arrowHit = this.#raycaster.intersectObjects(
			this.#translationArrowHitTargets.filter((target) => target.visible),
			false
		)[0];
		if (arrowHit) {
			event.preventDefault();
			const arrow = arrowHit.object as TranslationArrowPlane;
			const { axis, sign } = arrow.userData.direction as TranslationDirection;
			onTranslationChange(nudgeModelTranslation(translation, axis, sign, event.shiftKey));
			return true;
		}

		const modelHit = this.#raycaster.intersectObject(this.#modelMesh, false)[0];
		if (!modelHit) return false;

		const axis = event.shiftKey ? 'z' : 'xy';
		const plane = new Plane();
		if (axis === 'xy') {
			plane.setFromNormalAndCoplanarPoint(new Vector3(0, 0, 1), modelHit.point);
		} else {
			const cameraDirection = this.#camera.position.clone().sub(modelHit.point);
			cameraDirection.z = 0;
			if (cameraDirection.lengthSq() === 0) cameraDirection.set(0, 1, 0);
			plane.setFromNormalAndCoplanarPoint(cameraDirection.normalize(), modelHit.point);
		}

		const anchor = this.#raycaster.ray.intersectPlane(plane, new Vector3());
		if (!anchor) return false;

		event.preventDefault();
		this.#canvas.setPointerCapture(event.pointerId);
		this.#activeModelDrag = {
			kind: 'translation',
			pointerId: event.pointerId,
			axis,
			plane,
			anchor,
			initialTranslation: { ...translation },
			onChange: onTranslationChange,
			onInteractionChange
		};
		onInteractionChange({ kind: 'translation' });
		return true;
	}

	updateModelInteraction(event: PointerEvent): boolean {
		const drag = this.#activeModelDrag;
		if (!drag || drag.pointerId !== event.pointerId) return false;
		if (drag.kind === 'rotation') {
			this.#setPointer(event);
			const point = this.#raycaster.ray.intersectPlane(drag.plane, new Vector3());
			if (!point) return true;

			const radial = point.sub(drag.center);
			radial.addScaledVector(drag.axis.vector, -radial.dot(drag.axis.vector));
			if (radial.lengthSq() < 1e-8) return true;
			radial.normalize();

			drag.accumulatedAngle += signedRotationAngle(drag.previousRadial, radial, drag.axis.vector);
			drag.previousRadial.copy(radial);
			const angle = snapRotationAngle(drag.accumulatedAngle, event.shiftKey);
			const deltaRotation = new Quaternion().setFromAxisAngle(drag.axis.vector, angle);
			const rotation = deltaRotation.multiply(drag.initialRotation).normalize();
			drag.onChange({ x: rotation.x, y: rotation.y, z: rotation.z, w: rotation.w });
			return true;
		}

		this.#setPointer(event);
		const point = this.#raycaster.ray.intersectPlane(drag.plane, new Vector3());
		if (!point) return true;

		const delta = point.sub(drag.anchor);
		if (drag.axis === 'xy') {
			drag.onChange({
				x: drag.initialTranslation.x + delta.x,
				y: drag.initialTranslation.y + delta.y,
				z: drag.initialTranslation.z
			});
		} else {
			drag.onChange({
				x: drag.initialTranslation.x,
				y: drag.initialTranslation.y,
				z: drag.initialTranslation.z + delta.z
			});
		}
		return true;
	}

	stopModelInteraction(event: PointerEvent): boolean {
		const drag = this.#activeModelDrag;
		if (!drag || drag.pointerId !== event.pointerId) return false;
		if (this.#canvas.hasPointerCapture(event.pointerId)) {
			this.#canvas.releasePointerCapture(event.pointerId);
		}
		this.#activeModelDrag = null;
		drag.onInteractionChange(null);
		return true;
	}

	#startRotationDrag(
		event: PointerEvent,
		hitPoint: Vector3,
		axis: RotationAxis,
		rotation: ModelRotation,
		onChange: (rotation: ModelRotation) => void,
		onInteractionChange: (interaction: ModelInteraction | null) => void
	): boolean {
		const center = this.#modelCenter
			.clone()
			.add(
				new Vector3(
					this.#currentTranslation.x,
					this.#currentTranslation.y,
					this.#currentTranslation.z
				)
			);
		const radial = hitPoint.clone().sub(center);
		radial.addScaledVector(axis.vector, -radial.dot(axis.vector));
		if (radial.lengthSq() < 1e-8) return false;
		radial.normalize();

		event.preventDefault();
		this.#canvas.setPointerCapture(event.pointerId);
		this.#activeModelDrag = {
			kind: 'rotation',
			pointerId: event.pointerId,
			axis,
			plane: new Plane().setFromNormalAndCoplanarPoint(axis.vector, center),
			center,
			previousRadial: radial,
			accumulatedAngle: 0,
			initialRotation: toQuaternion(rotation),
			onChange,
			onInteractionChange
		};
		onInteractionChange({ kind: 'rotation', axis: axis.axis });
		return true;
	}

	schedule(state: BuildVolumeRenderState) {
		this.#pendingState = state;
		if (this.#animationFrame !== null) return;

		this.#animationFrame = requestAnimationFrame(() => {
			this.#animationFrame = null;
			const latestState = this.#pendingState;
			this.#pendingState = null;
			if (latestState) this.#render(latestState);
		});
	}

	dispose() {
		if (this.#animationFrame !== null) cancelAnimationFrame(this.#animationFrame);
		this.#cancelModelDrag();
		const geometries = new Set<BufferGeometry>();
		const materials = new Set<Material>([this.#modelMaterial, this.#outsideModelMaterial]);
		this.#scene.traverse((object) => {
			if (object instanceof Mesh || object instanceof Line) {
				geometries.add(object.geometry);
				const objectMaterials = Array.isArray(object.material)
					? object.material
					: [object.material];
				for (const material of objectMaterials) materials.add(material);
			}
		});
		for (const geometry of geometries) geometry.dispose();
		for (const material of materials) material.dispose();
		this.#arrowTexture.dispose();
		this.#renderer.dispose();
	}

	#render(state: BuildVolumeRenderState) {
		if (state.width <= 0 || state.height <= 0) return;
		this.#resize(state.width, state.height, state.dpr);
		this.#setModel(state.model);
		this.#setModelTransform(state.modelTranslation, state.modelRotation);

		this.#camera.position.set(
			CAMERA_TARGET.x + CAMERA_DISTANCE * Math.cos(state.cameraPitch) * Math.cos(state.cameraYaw),
			CAMERA_TARGET.y + CAMERA_DISTANCE * Math.cos(state.cameraPitch) * Math.sin(state.cameraYaw),
			CAMERA_TARGET.z + CAMERA_DISTANCE * Math.sin(state.cameraPitch)
		);
		this.#camera.lookAt(CAMERA_TARGET);
		this.#updateTranslationArrows();
		this.#updateRotationRings();
		this.#renderer.render(this.#scene, this.#camera);
	}

	#resize(width: number, height: number, dpr: number) {
		if (width === this.#width && height === this.#height && dpr === this.#dpr) return;
		this.#width = width;
		this.#height = height;
		this.#dpr = dpr;
		this.#camera.aspect = width / height;
		this.#camera.updateProjectionMatrix();
		this.#renderer.setPixelRatio(dpr);
		this.#renderer.setSize(width, height, false);
	}

	#setModel(model: ImportedStlModel | null) {
		if (model === this.#currentModel) return;
		this.#cancelModelDrag();
		this.#currentModel = model;
		if (this.#modelMesh) {
			this.#scene.remove(this.#modelMesh);
			this.#modelMesh.geometry.dispose();
			this.#modelMesh = null;
		}
		if (this.#outsideModelMesh) {
			this.#scene.remove(this.#outsideModelMesh);
			this.#outsideModelMesh = null;
		}
		if (!model) {
			for (const arrow of this.#translationArrows) arrow.group.visible = false;
			for (const ring of this.#rotationRings) ring.group.visible = false;
			return;
		}

		this.#modelCenter.set(
			(model.bounds.min.x + model.bounds.max.x) / 2,
			(model.bounds.min.y + model.bounds.max.y) / 2,
			(model.bounds.min.z + model.bounds.max.z) / 2
		);
		const halfDimensions = new Vector3(
			(model.bounds.max.x - model.bounds.min.x) / 2,
			(model.bounds.max.y - model.bounds.min.y) / 2,
			(model.bounds.max.z - model.bounds.min.z) / 2
		);
		this.#rotationRingRadius = Math.max(
			MIN_ROTATION_RING_RADIUS,
			halfDimensions.length() + ROTATION_RING_GAP
		);
		const geometry = new BufferGeometry();
		geometry.setAttribute('position', new BufferAttribute(model.positions.slice(), 3));
		geometry.setAttribute('normal', new BufferAttribute(model.normals, 3));
		geometry.translate(-this.#modelCenter.x, -this.#modelCenter.y, -this.#modelCenter.z);
		geometry.computeBoundingSphere();
		this.#modelMesh = new Mesh(geometry, this.#modelMaterial);
		this.#modelMesh.renderOrder = 1;
		this.#outsideModelMesh = new Mesh(geometry, this.#outsideModelMaterial);
		this.#outsideModelMesh.renderOrder = 2;
		this.#scene.add(this.#modelMesh);
		this.#scene.add(this.#outsideModelMesh);
	}

	#setModelTransform(translation: ModelTranslation, rotation: ModelRotation) {
		this.#currentTranslation = translation;
		this.#currentRotation = rotation;
		const quaternion = toQuaternion(rotation);
		const position = this.#modelCenter
			.clone()
			.add(new Vector3(translation.x, translation.y, translation.z));
		if (this.#modelMesh) {
			this.#modelMesh.position.copy(position);
			this.#modelMesh.quaternion.copy(quaternion);
		}
		if (this.#outsideModelMesh) {
			this.#outsideModelMesh.position.copy(position);
			this.#outsideModelMesh.quaternion.copy(quaternion);
		}
	}

	#setPointer(event: PointerEvent) {
		const bounds = this.#canvas.getBoundingClientRect();
		this.#pointer.set(
			((event.clientX - bounds.left) / bounds.width) * 2 - 1,
			-((event.clientY - bounds.top) / bounds.height) * 2 + 1
		);
		this.#raycaster.setFromCamera(this.#pointer, this.#camera);
	}

	#cancelModelDrag() {
		const drag = this.#activeModelDrag;
		if (!drag) return;
		if (this.#canvas.hasPointerCapture(drag.pointerId)) {
			this.#canvas.releasePointerCapture(drag.pointerId);
		}
		this.#activeModelDrag = null;
		drag.onInteractionChange(null);
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
				this.#translationArrowHitTargets.push(plane);
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
			this.#scene.add(group);
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
			this.#rotationRingHitTargets.push(hitTarget);
			this.#scene.add(group);
		}
	}

	#updateTranslationArrows() {
		if (!this.#currentModel) return;
		const bounds = transformModelBounds(
			this.#currentModel.bounds,
			this.#currentTranslation,
			this.#currentRotation
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

			const viewDirection = this.#camera.position.clone().sub(arrow.group.position).normalize();
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

	#updateRotationRings() {
		if (!this.#currentModel) return;
		const center = this.#modelCenter
			.clone()
			.add(
				new Vector3(
					this.#currentTranslation.x,
					this.#currentTranslation.y,
					this.#currentTranslation.z
				)
			);
		for (const ring of this.#rotationRings) {
			ring.group.position.copy(center);
			ring.group.scale.setScalar(this.#rotationRingRadius);
			ring.group.visible = true;
			ring.material.opacity =
				this.#activeModelDrag?.kind === 'rotation' &&
				this.#activeModelDrag.axis.axis === ring.axis.axis
					? 1
					: 0.4;
		}
	}

	#createBuildVolume(): Group {
		const group = new Group();
		group.add(this.#createPlate());
		group.add(this.#createGrid());
		group.add(this.#createBounds());
		group.add(this.#createAxes());
		return group;
	}

	#createPlate(): Mesh {
		const geometry = new PlaneGeometry(BUILD_VOLUME.x, BUILD_VOLUME.y);
		const material = new MeshBasicMaterial({
			color: 0x2f4b65,
			opacity: 0.3,
			transparent: true,
			side: DoubleSide,
			depthWrite: false
		});
		const plate = new Mesh(geometry, material);
		plate.position.set(BUILD_VOLUME.x / 2, BUILD_VOLUME.y / 2, -0.01);
		return plate;
	}

	#createGrid(): LineSegments {
		const vertices: number[] = [];
		for (let x = 5.1; x < BUILD_VOLUME.x; x += 5.1) {
			vertices.push(x, 0, 0, x, BUILD_VOLUME.y, 0);
		}
		for (let y = 5.1; y < BUILD_VOLUME.y; y += 5.1) {
			vertices.push(0, y, 0, BUILD_VOLUME.x, y, 0);
		}
		return this.#createLines(vertices, 0x324054, 0.78);
	}

	#createBounds(): LineSegments {
		const { x, y, z } = BUILD_VOLUME;
		const segments = [
			[0, 0, 0, x, 0, 0],
			[x, 0, 0, x, y, 0],
			[x, y, 0, 0, y, 0],
			[0, y, 0, 0, 0, 0],
			[0, 0, z, x, 0, z],
			[x, 0, z, x, y, z],
			[x, y, z, 0, y, z],
			[0, y, z, 0, 0, z],
			[0, 0, 0, 0, 0, z],
			[x, 0, 0, x, 0, z],
			[x, y, 0, x, y, z],
			[0, y, 0, 0, y, z]
		];
		return this.#createLines(segments.flat(), 0x70819a, 0.72);
	}

	#createAxes(): Group {
		const axes = new Group();
		const origin = new Vector3(0, BUILD_VOLUME.y, 0);
		const xDirection = new Vector3(1, 0, 0);
		const yDirection = new Vector3(0, -1, 0);
		const zDirection = new Vector3(0, 0, 1);
		const xRulerDirection = new Vector3(0, 1, 0);
		const yRulerDirection = new Vector3(-1, 0, 0);
		const zRulerDirection = new Vector3(-1, 1, 0);

		axes.add(new ArrowHelper(xDirection, origin, BUILD_VOLUME.x, 0xff6b70, 1.5, 0.8));
		axes.add(new ArrowHelper(yDirection, origin, BUILD_VOLUME.y, 0x6ee7a8, 1.5, 0.8));
		axes.add(new ArrowHelper(zDirection, origin, BUILD_VOLUME.z, 0x6bb8ff, 1.8, 0.9));
		axes.add(
			this.#createLines(
				createMillimetreRulerVertices(origin, xDirection, xRulerDirection, BUILD_VOLUME.x),
				0xff6b70,
				0.88
			)
		);
		axes.add(
			this.#createLines(
				createMillimetreRulerVertices(origin, yDirection, yRulerDirection, BUILD_VOLUME.y),
				0x6ee7a8,
				0.88
			)
		);
		axes.add(
			this.#createLines(
				createMillimetreRulerVertices(origin, zDirection, zRulerDirection, BUILD_VOLUME.z),
				0x6bb8ff,
				0.88
			)
		);
		const marker = new Mesh(
			new SphereGeometry(0.38, 12, 8),
			new MeshBasicMaterial({ color: 0xdce7f4 })
		);
		marker.position.copy(origin);
		axes.add(marker);
		return axes;
	}

	#createLines(vertices: number[], color: number, opacity: number): LineSegments {
		const geometry = new BufferGeometry();
		geometry.setAttribute('position', new Float32BufferAttribute(vertices, 3));
		const material = new LineBasicMaterial({ color, opacity, transparent: opacity < 1 });
		return new LineSegments(geometry, material);
	}
}

const VIEWPORTS = new WeakMap<HTMLCanvasElement, BuildVolumeViewport>();

function getViewport(canvas: HTMLCanvasElement): BuildVolumeViewport {
	let viewport = VIEWPORTS.get(canvas);
	if (!viewport) {
		viewport = new BuildVolumeViewport(canvas);
		VIEWPORTS.set(canvas, viewport);
	}
	return viewport;
}

export function initializeBuildVolume(canvas: HTMLCanvasElement) {
	const viewport = getViewport(canvas);
	return () => {
		if (VIEWPORTS.get(canvas) !== viewport) return;
		VIEWPORTS.delete(canvas);
		viewport.dispose();
	};
}

export function paintBuildVolume(state: BuildVolumeRenderState) {
	return (canvas: HTMLCanvasElement) => getViewport(canvas).schedule(state);
}

export function startModelTransform(
	event: PointerEvent,
	translation: ModelTranslation,
	rotation: ModelRotation,
	onTranslationChange: (translation: ModelTranslation) => void,
	onRotationChange: (rotation: ModelRotation) => void,
	onInteractionChange: (interaction: ModelInteraction | null) => void
): boolean {
	return getViewport(event.currentTarget as HTMLCanvasElement).startModelInteraction(
		event,
		translation,
		rotation,
		onTranslationChange,
		onRotationChange,
		onInteractionChange
	);
}

export function updateModelTransform(event: PointerEvent): boolean {
	return getViewport(event.currentTarget as HTMLCanvasElement).updateModelInteraction(event);
}

export function stopModelTransform(event: PointerEvent): boolean {
	return getViewport(event.currentTarget as HTMLCanvasElement).stopModelInteraction(event);
}
