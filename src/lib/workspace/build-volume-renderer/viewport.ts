import {
	DirectionalLight,
	HemisphereLight,
	PerspectiveCamera,
	Scene,
	SRGBColorSpace,
	Vector3,
	WebGLRenderer
} from 'three';

import { TINYMAKER_PROFILE } from '$lib/printer/tinymaker';
import type { ModelSurfaceHit } from '../supports';
import { BuildVolumeScene } from './build-volume-scene';
import { ModelInteractionController } from './model-interaction';
import { PreviewRenderer } from './preview-renderer';
import { RaftRenderer } from './raft-renderer';
import { RenderedModel } from './rendered-model';
import { SliceScanInteractionController } from './slice-scan-interaction';
import { SliceScanRenderer } from './slice-scan-renderer';
import { SupportMarkerRenderer } from './support-marker-renderer';
import { SupportRenderer } from './support-renderer';
import { TransformGizmo } from './transform-gizmo';
import type {
	BuildVolumeRenderState,
	ModelInteraction,
	ModelRotation,
	ModelScale,
	ModelTranslation
} from './types';

const BUILD_VOLUME = TINYMAKER_PROFILE.buildVolume;
const CAMERA_TARGET = new Vector3(BUILD_VOLUME.x / 2, BUILD_VOLUME.y / 2, BUILD_VOLUME.z * 0.42);
const CAMERA_DISTANCE = 112;

export class BuildVolumeViewport {
	#renderer: WebGLRenderer;
	#scene = new Scene();
	#camera = new PerspectiveCamera(36, 1, 0.1, 500);
	#buildVolumeScene = new BuildVolumeScene();
	#model: RenderedModel;
	#supports: SupportRenderer;
	#rafts: RaftRenderer;
	#supportMarkers: SupportMarkerRenderer;
	#preview: PreviewRenderer;
	#scan: SliceScanRenderer;
	#gizmo: TransformGizmo;
	#interactions: ModelInteractionController;
	#scanInteraction: SliceScanInteractionController;
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
		this.#renderer.localClippingEnabled = true;
		this.#camera.up.set(0, 0, 1);
		this.#scene.add(this.#buildVolumeScene.group);

		this.#model = new RenderedModel(this.#scene);
		this.#supports = new SupportRenderer(this.#scene);
		this.#rafts = new RaftRenderer(this.#scene);
		this.#supportMarkers = new SupportMarkerRenderer(this.#scene);
		this.#preview = new PreviewRenderer(this.#scene);
		this.#scan = new SliceScanRenderer(this.#scene);
		this.#gizmo = new TransformGizmo(this.#scene);
		this.#interactions = new ModelInteractionController(
			canvas,
			this.#camera,
			this.#model,
			this.#gizmo,
			this.#supportMarkers
		);
		this.#scanInteraction = new SliceScanInteractionController(canvas, this.#camera);

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
		scale: ModelScale,
		onTranslationChange: (translation: ModelTranslation) => void,
		onRotationChange: (rotation: ModelRotation) => void,
		onScaleChange: (scale: ModelScale) => void,
		onInteractionChange: (interaction: ModelInteraction | null) => void
	): boolean {
		return this.#interactions.startModelInteraction(
			event,
			translation,
			rotation,
			scale,
			onTranslationChange,
			onRotationChange,
			onScaleChange,
			onInteractionChange
		);
	}

	pickModelSurface(event: PointerEvent): ModelSurfaceHit | null {
		return this.#interactions.pickModelSurface(event);
	}

	pickSupportPoint(event: PointerEvent): string | null {
		return this.#interactions.pickSupportPoint(event);
	}

	updateModelInteraction(event: PointerEvent): boolean {
		return this.#interactions.updateModelInteraction(event);
	}

	stopModelInteraction(event: PointerEvent): boolean {
		return this.#interactions.stopModelInteraction(event);
	}

	startScanDrag(
		event: PointerEvent,
		zMm: number,
		zHeightMm: number,
		onZChange: (zMm: number) => void
	): boolean {
		if (!this.#scan.mesh.visible) return false;
		return this.#scanInteraction.start(event, this.#scan.mesh, zMm, zHeightMm, onZChange);
	}

	updateScanDrag(event: PointerEvent): boolean {
		return this.#scanInteraction.update(event);
	}

	stopScanDrag(event: PointerEvent): boolean {
		return this.#scanInteraction.stop(event);
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
		this.#interactions.cancel();
		this.#scanInteraction.cancel();
		this.#model.dispose();
		this.#supports.dispose();
		this.#rafts.dispose();
		this.#supportMarkers.dispose();
		this.#preview.dispose();
		this.#scan.dispose();
		this.#gizmo.dispose();
		this.#scene.remove(this.#buildVolumeScene.group);
		this.#buildVolumeScene.dispose();
		this.#renderer.dispose();
	}

	#render(state: BuildVolumeRenderState) {
		if (state.width <= 0 || state.height <= 0) return;
		this.#resize(state.width, state.height, state.dpr);
		const previewing = state.previewMesh !== null;
		if (this.#model.setModel(state.model)) this.#interactions.cancel();
		this.#model.setTransform(state.modelTranslation, state.modelRotation, state.modelScale);
		this.#model.setSupportRiskVisible(state.interactionMode === 'place-supports');
		this.#model.setVisible(!previewing);
		this.#interactions.setInteractionMode(state.interactionMode);
		// An active scan drag can outlive scan mode being toggled off (or the preview
		// resetting) mid-gesture; without this the pointer capture would leak until
		// the caller happens to route another pointer event through updateScanDrag.
		if (!previewing || state.scanZMm === null) this.#scanInteraction.cancel();
		this.#supports.setStructures(state.supportStructures);
		this.#supports.setTranslucent(state.interactionMode === 'place-supports');
		this.#supports.setVisible(!previewing);
		this.#rafts.setIslands(state.raftIslands);
		this.#rafts.setTranslucent(state.interactionMode === 'place-supports');
		this.#rafts.setVisible(!previewing);
		this.#supportMarkers.setPoints(state.supportPoints);
		this.#supportMarkers.setVisible(state.interactionMode === 'place-supports');
		this.#preview.setMesh(state.previewMesh);
		this.#preview.setVisible(previewing);
		this.#preview.setScanClip(previewing ? state.scanZMm : null);
		this.#scan.setImage(previewing ? state.scanImage : null);
		if (state.scanZMm !== null) this.#scan.setZ(state.scanZMm);
		this.#buildVolumeScene.setSupportPlateMarginVisible(
			state.interactionMode === 'transform-model'
		);

		this.#camera.position.set(
			CAMERA_TARGET.x + CAMERA_DISTANCE * Math.cos(state.cameraPitch) * Math.cos(state.cameraYaw),
			CAMERA_TARGET.y + CAMERA_DISTANCE * Math.cos(state.cameraPitch) * Math.sin(state.cameraYaw),
			CAMERA_TARGET.z + CAMERA_DISTANCE * Math.sin(state.cameraPitch)
		);
		this.#camera.lookAt(CAMERA_TARGET);
		this.#gizmo.update({
			model: state.model,
			translation: state.modelTranslation,
			rotation: state.modelRotation,
			scale: state.modelScale,
			interactionMode: state.interactionMode,
			camera: this.#camera,
			modelCenter: this.#model.worldCenter,
			rotationRingRadius: this.#model.rotationRingRadius * state.modelScale,
			activeRotationAxis: this.#interactions.activeRotationAxis,
			activeScaleHandle: this.#interactions.activeScaleHandle
		});
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
}
