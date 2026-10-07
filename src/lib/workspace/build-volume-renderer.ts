import type { ModelSurfaceHit } from './supports';
import type {
	BuildVolumeRenderState,
	ModelInteraction,
	ModelRotation,
	ModelScale,
	ModelTranslation
} from './build-volume-renderer/types';
import { BuildVolumeViewport } from './build-volume-renderer/viewport';

export {
	createBuildVolumeClippingPlanes,
	createMillimetreRulerVertices
} from './build-volume-renderer/build-volume-scene';
export {
	areBoundsOutsideBuildVolume,
	clampModelScale,
	createModelPointTransformer,
	DEFAULT_MODEL_SCALE,
	firstBuildVolumeOverflowDirection,
	IDENTITY_MODEL_ROTATION,
	isModelOutsideBuildVolume,
	modelRotationDegrees,
	modelBottomCenter,
	nudgeModelTranslation,
	ROTATION_SNAP_DEGREES,
	signedRotationAngle,
	snapRotationAngle,
	transformModelBounds,
	transformModelGeometryBounds,
	transformModelPoint,
	translateModelBounds
} from './build-volume-renderer/model-transform';
export {
	SUPPORT_MARKER_RADIUS_MM,
	SUPPORT_MARKER_SURFACE_OFFSET_MM
} from './build-volume-renderer/support-marker-renderer';
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
	ModelScale,
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
	scale: ModelScale,
	onTranslationChange: (translation: ModelTranslation) => void,
	onRotationChange: (rotation: ModelRotation) => void,
	onScaleChange: (scale: ModelScale) => void,
	onInteractionChange: (interaction: ModelInteraction | null) => void
): boolean {
	return getViewport(event.currentTarget as HTMLCanvasElement).startModelInteraction(
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

export function pickModelSurface(
	event: PointerEvent,
	allowNonPrimary = false
): ModelSurfaceHit | null {
	return getViewport(event.currentTarget as HTMLCanvasElement).pickModelSurface(
		event,
		allowNonPrimary
	);
}

export function pickSupportPoint(event: PointerEvent): string | null {
	return getViewport(event.currentTarget as HTMLCanvasElement).pickSupportPoint(event);
}

export function startSupportPointDrag(
	event: PointerEvent,
	onChange: (supportPointId: string, hit: ModelSurfaceHit) => void
): boolean {
	return getViewport(event.currentTarget as HTMLCanvasElement).startSupportPointDrag(
		event,
		onChange
	);
}

export function updateSupportPointDrag(event: PointerEvent): boolean {
	return getViewport(event.currentTarget as HTMLCanvasElement).updateSupportPointDrag(event);
}

export function stopSupportPointDrag(event: PointerEvent): boolean {
	return getViewport(event.currentTarget as HTMLCanvasElement).stopSupportPointDrag(event);
}

export function updateModelTransform(event: PointerEvent): boolean {
	return getViewport(event.currentTarget as HTMLCanvasElement).updateModelInteraction(event);
}

export function stopModelTransform(event: PointerEvent): boolean {
	return getViewport(event.currentTarget as HTMLCanvasElement).stopModelInteraction(event);
}

export function startScanDrag(
	event: PointerEvent,
	zMm: number,
	zHeightMm: number,
	onZChange: (zMm: number) => void
): boolean {
	return getViewport(event.currentTarget as HTMLCanvasElement).startScanDrag(
		event,
		zMm,
		zHeightMm,
		onZChange
	);
}

export function updateScanDrag(event: PointerEvent): boolean {
	return getViewport(event.currentTarget as HTMLCanvasElement).updateScanDrag(event);
}

export function stopScanDrag(event: PointerEvent): boolean {
	return getViewport(event.currentTarget as HTMLCanvasElement).stopScanDrag(event);
}
