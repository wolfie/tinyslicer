import type { Bounds3 } from '$lib/workspace/stl-importer';
import type { ModelRotation, ModelTranslation } from '$lib/workspace/build-volume-renderer/types';
import type { SupportPlan } from '$lib/workspace/supports';

/** Posted to the worker to start (or supersede) a preview build. `positions` is
 *  transferred, so the caller must hand over a copy it no longer needs. */
export type PreviewMeshRequest = {
	id: number;
	positions: Float32Array;
	bounds: Bounds3;
	translation: ModelTranslation;
	rotation: ModelRotation;
	supportPlan: SupportPlan;
};

export type PreviewMeshProgressMessage = {
	type: 'progress';
	id: number;
	completed: number;
	total: number;
};

export type PreviewMeshResultMessage = {
	type: 'result';
	id: number;
	positions: Float32Array;
	normals: Float32Array;
	triangleCount: number;
	layerCount: number;
	zHeightMm: number;
	meshIsWatertightAtPixelSamples: boolean;
};

export type PreviewMeshErrorMessage = {
	type: 'error';
	id: number;
	message: string;
};

export type PreviewMeshWorkerMessage =
	PreviewMeshProgressMessage | PreviewMeshResultMessage | PreviewMeshErrorMessage;
