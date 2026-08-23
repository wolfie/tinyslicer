import {
	ArrowHelper,
	BufferAttribute,
	BufferGeometry,
	DirectionalLight,
	DoubleSide,
	Float32BufferAttribute,
	Group,
	HemisphereLight,
	Line,
	LineBasicMaterial,
	LineSegments,
	Mesh,
	MeshBasicMaterial,
	MeshStandardMaterial,
	PerspectiveCamera,
	PlaneGeometry,
	Scene,
	SphereGeometry,
	SRGBColorSpace,
	Vector3,
	WebGLRenderer
} from 'three';

import { TINYMAKER_PROFILE } from '$lib/printer/tinymaker';
import type { ImportedStlModel } from '$lib/workspace/stl-importer';

export type BuildVolumeRenderState = {
	cameraYaw: number;
	cameraPitch: number;
	width: number;
	height: number;
	dpr: number;
	model: ImportedStlModel | null;
};

const BUILD_VOLUME = TINYMAKER_PROFILE.buildVolume;
const CAMERA_TARGET = new Vector3(BUILD_VOLUME.x / 2, BUILD_VOLUME.y / 2, BUILD_VOLUME.z * 0.42);
const CAMERA_DISTANCE = 112;

class BuildVolumeViewport {
	#renderer: WebGLRenderer;
	#scene = new Scene();
	#camera = new PerspectiveCamera(36, 1, 0.1, 500);
	#modelMaterial = new MeshStandardMaterial({
		color: 0x62b7ed,
		roughness: 0.62,
		metalness: 0.04,
		side: DoubleSide
	});
	#modelMesh: Mesh | null = null;
	#currentModel: ImportedStlModel | null = null;
	#pendingState: BuildVolumeRenderState | null = null;
	#animationFrame: number | null = null;
	#width = 0;
	#height = 0;
	#dpr = 0;

	constructor(canvas: HTMLCanvasElement) {
		this.#renderer = new WebGLRenderer({
			canvas,
			alpha: true,
			antialias: true,
			powerPreference: 'high-performance'
		});
		this.#renderer.setClearColor(0x000000, 0);
		this.#renderer.outputColorSpace = SRGBColorSpace;
		this.#camera.up.set(0, 0, 1);
		this.#scene.add(this.#createBuildVolume());
		this.#scene.add(new HemisphereLight(0xddeeff, 0x152536, 1.65));

		const keyLight = new DirectionalLight(0xffffff, 2.15);
		keyLight.position.set(-45, -55, 95);
		this.#scene.add(keyLight);

		const fillLight = new DirectionalLight(0x79bfff, 0.7);
		fillLight.position.set(70, 45, 35);
		this.#scene.add(fillLight);
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
		this.#scene.traverse((object) => {
			if (object instanceof Mesh || object instanceof Line) {
				object.geometry.dispose();
				const materials = Array.isArray(object.material) ? object.material : [object.material];
				for (const material of materials) material.dispose();
			}
		});
		this.#renderer.dispose();
	}

	#render(state: BuildVolumeRenderState) {
		if (state.width <= 0 || state.height <= 0) return;
		this.#resize(state.width, state.height, state.dpr);
		this.#setModel(state.model);

		this.#camera.position.set(
			CAMERA_TARGET.x + CAMERA_DISTANCE * Math.cos(state.cameraPitch) * Math.cos(state.cameraYaw),
			CAMERA_TARGET.y + CAMERA_DISTANCE * Math.cos(state.cameraPitch) * Math.sin(state.cameraYaw),
			CAMERA_TARGET.z + CAMERA_DISTANCE * Math.sin(state.cameraPitch)
		);
		this.#camera.lookAt(CAMERA_TARGET);
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
		this.#currentModel = model;
		if (this.#modelMesh) {
			this.#scene.remove(this.#modelMesh);
			this.#modelMesh.geometry.dispose();
			this.#modelMesh = null;
		}
		if (!model) return;

		const geometry = new BufferGeometry();
		geometry.setAttribute('position', new BufferAttribute(model.positions, 3));
		geometry.setAttribute('normal', new BufferAttribute(model.normals, 3));
		geometry.computeBoundingSphere();
		this.#modelMesh = new Mesh(geometry, this.#modelMaterial);
		this.#modelMesh.renderOrder = 1;
		this.#scene.add(this.#modelMesh);
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
		axes.add(new ArrowHelper(new Vector3(1, 0, 0), origin, BUILD_VOLUME.x, 0xff6b70, 1.5, 0.8));
		axes.add(new ArrowHelper(new Vector3(0, -1, 0), origin, BUILD_VOLUME.y, 0x6ee7a8, 1.5, 0.8));
		axes.add(new ArrowHelper(new Vector3(0, 0, 1), origin, BUILD_VOLUME.z, 0x6bb8ff, 1.8, 0.9));
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
