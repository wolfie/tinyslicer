import type { ModelSurfaceHit } from './supports';
import type {
	BuildVolumeRenderState,
	ModelInteraction,
	ModelRotation,
	ModelTranslation
} from './build-volume-renderer/types';
import { BuildVolumeViewport } from './build-volume-renderer/viewport';

export {
	createBuildVolumeClippingPlanes,
	createMillimetreRulerVertices
} from './build-volume-renderer/build-volume-scene';
export {
	areBoundsOutsideBuildVolume,
	firstBuildVolumeOverflowDirection,
	IDENTITY_MODEL_ROTATION,
	isModelOutsideBuildVolume,
	modelRotationDegrees,
	nudgeModelTranslation,
	ROTATION_SNAP_DEGREES,
	signedRotationAngle,
	snapRotationAngle,
	transformModelBounds,
	transformModelGeometryBounds,
	translateModelBounds
} from './build-volume-renderer/model-transform';
export { findModelSurfaceBelow } from './build-volume-renderer/support-picking';
export {
	createRotationRingGeometry,
	translationArrowPlaneWeights
} from './build-volume-renderer/transform-gizmo';
export type {
	BuildVolumeInteractionMode,
	BuildVolumeRenderState,
	ModelInteraction,
	ModelRotation,
	ModelTranslation
} from './build-volume-renderer/types';

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

export function pickModelSurface(event: PointerEvent): ModelSurfaceHit | null {
	return getViewport(event.currentTarget as HTMLCanvasElement).pickModelSurface(event);
}

export function updateModelTransform(event: PointerEvent): boolean {
	return getViewport(event.currentTarget as HTMLCanvasElement).updateModelInteraction(event);
}

export function stopModelTransform(event: PointerEvent): boolean {
	return getViewport(event.currentTarget as HTMLCanvasElement).stopModelInteraction(event);
}
