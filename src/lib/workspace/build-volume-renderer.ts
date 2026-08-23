import {
	ArrowHelper,
	BufferAttribute,
	BufferGeometry,
	CanvasTexture,
	DirectionalLight,
	DoubleSide,
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
	Raycaster,
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

export type BuildVolumeRenderState = {
	cameraYaw: number;
	cameraPitch: number;
	width: number;
	height: number;
	dpr: number;
	model: ImportedStlModel | null;
	modelTranslation: ModelTranslation;
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
const SMALL_TRANSLATION_STEP = 1;
const LARGE_TRANSLATION_STEP = 5;
const ZERO_TRANSLATION: ModelTranslation = { x: 0, y: 0, z: 0 };

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
};

type ActiveModelDrag = {
	pointerId: number;
	axis: 'xy' | 'z';
	plane: Plane;
	anchor: Vector3;
	initialTranslation: ModelTranslation;
	onChange: (translation: ModelTranslation) => void;
	onDraggingChange: (dragging: boolean) => void;
};

const TRANSLATION_DIRECTIONS: TranslationDirection[] = [
	{ axis: 'x', sign: 1, vector: new Vector3(1, 0, 0), color: 0xff777b },
	{ axis: 'x', sign: -1, vector: new Vector3(-1, 0, 0), color: 0xff777b },
	{ axis: 'y', sign: 1, vector: new Vector3(0, 1, 0), color: 0x72e7ac },
	{ axis: 'y', sign: -1, vector: new Vector3(0, -1, 0), color: 0x72e7ac },
	{ axis: 'z', sign: 1, vector: new Vector3(0, 0, 1), color: 0x75bdff },
	{ axis: 'z', sign: -1, vector: new Vector3(0, 0, -1), color: 0x75bdff }
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

export function isModelOutsideBuildVolume(
	model: ImportedStlModel,
	translation: ModelTranslation = ZERO_TRANSLATION
): boolean {
	const bounds = translateModelBounds(model.bounds, translation);
	return (
		bounds.min.x < 0 ||
		bounds.max.x > BUILD_VOLUME.x ||
		bounds.min.y < 0 ||
		bounds.max.y > BUILD_VOLUME.y ||
		bounds.min.z < 0 ||
		bounds.max.z > BUILD_VOLUME.z
	);
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
	#currentModel: ImportedStlModel | null = null;
	#currentTranslation: ModelTranslation = ZERO_TRANSLATION;
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
		onChange: (translation: ModelTranslation) => void,
		onDraggingChange: (dragging: boolean) => void
	): boolean {
		if (event.button !== 0 || !this.#modelMesh) return false;
		this.#setPointer(event);

		const arrowHit = this.#raycaster.intersectObjects(this.#translationArrowHitTargets, false)[0];
		if (arrowHit) {
			event.preventDefault();
			const arrow = arrowHit.object as TranslationArrowPlane;
			const { axis, sign } = arrow.userData.direction as TranslationDirection;
			onChange(nudgeModelTranslation(translation, axis, sign, event.shiftKey));
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
			pointerId: event.pointerId,
			axis,
			plane,
			anchor,
			initialTranslation: { ...translation },
			onChange,
			onDraggingChange
		};
		onDraggingChange(true);
		return true;
	}

	updateModelInteraction(event: PointerEvent): boolean {
		const drag = this.#activeModelDrag;
		if (!drag || drag.pointerId !== event.pointerId) return false;
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
		drag.onDraggingChange(false);
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
		this.#setModelTranslation(state.modelTranslation);

		this.#camera.position.set(
			CAMERA_TARGET.x + CAMERA_DISTANCE * Math.cos(state.cameraPitch) * Math.cos(state.cameraYaw),
			CAMERA_TARGET.y + CAMERA_DISTANCE * Math.cos(state.cameraPitch) * Math.sin(state.cameraYaw),
			CAMERA_TARGET.z + CAMERA_DISTANCE * Math.sin(state.cameraPitch)
		);
		this.#camera.lookAt(CAMERA_TARGET);
		this.#updateTranslationArrows();
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
			return;
		}

		const geometry = new BufferGeometry();
		geometry.setAttribute('position', new BufferAttribute(model.positions, 3));
		geometry.setAttribute('normal', new BufferAttribute(model.normals, 3));
		geometry.computeBoundingSphere();
		this.#modelMesh = new Mesh(geometry, this.#modelMaterial);
		this.#modelMesh.renderOrder = 1;
		this.#outsideModelMesh = new Mesh(geometry, this.#outsideModelMaterial);
		this.#outsideModelMesh.renderOrder = 2;
		this.#scene.add(this.#modelMesh);
		this.#scene.add(this.#outsideModelMesh);
	}

	#setModelTranslation(translation: ModelTranslation) {
		this.#currentTranslation = translation;
		if (this.#modelMesh) this.#modelMesh.position.set(translation.x, translation.y, translation.z);
		if (this.#outsideModelMesh) {
			this.#outsideModelMesh.position.set(translation.x, translation.y, translation.z);
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
		drag.onDraggingChange(false);
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
			const material = new MeshBasicMaterial({
				map: this.#arrowTexture,
				color: direction.color,
				depthTest: false,
				depthWrite: false,
				opacity: 0.68,
				side: DoubleSide,
				transparent: true
			});
			const firstPlane = new Mesh(this.#arrowGeometry, material) as TranslationArrowPlane;
			const crossedPlane = new Mesh(this.#arrowGeometry, material) as TranslationArrowPlane;
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
			this.#translationArrows.push({ direction, group });
			this.#scene.add(group);
		}
	}

	#updateTranslationArrows() {
		if (!this.#currentModel) return;
		const bounds = translateModelBounds(this.#currentModel.bounds, this.#currentTranslation);
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

export function startModelTranslation(
	event: PointerEvent,
	translation: ModelTranslation,
	onChange: (translation: ModelTranslation) => void,
	onDraggingChange: (dragging: boolean) => void
): boolean {
	return getViewport(event.currentTarget as HTMLCanvasElement).startModelInteraction(
		event,
		translation,
		onChange,
		onDraggingChange
	);
}

export function updateModelTranslation(event: PointerEvent): boolean {
	return getViewport(event.currentTarget as HTMLCanvasElement).updateModelInteraction(event);
}

export function stopModelTranslation(event: PointerEvent): boolean {
	return getViewport(event.currentTarget as HTMLCanvasElement).stopModelInteraction(event);
}
