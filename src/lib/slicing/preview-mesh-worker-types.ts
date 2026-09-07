import type { RaftIsland } from '$lib/supports/raft-plan';
import type { Bounds3 } from '$lib/workspace/stl-importer';
import type {
	ModelRotation,
	ModelScale,
	ModelTranslation
} from '$lib/workspace/build-volume-renderer/types';
import type { SupportPlan } from '$lib/workspace/supports';

/** Posted to the worker to start (or supersede) a preview build. `positions` is
 *  transferred, so the caller must hand over a copy it no longer needs. */

export type PreviewMeshBuildRequest = {
	type: 'build';
	id: number;
	positions: Float32Array;
	bounds: Bounds3;
	translation: ModelTranslation;
	rotation: ModelRotation;
	scale: ModelScale;
	supportPlan: SupportPlan;
	raftIslands: readonly RaftIsland[];
};

export type PreviewMeshExportStartRequest = { type: 'export-start'; id: number; exportId: number };
export type PreviewMeshExportContinueRequest = {
	type: 'export-continue';
	id: number;
	exportId: number;
};
export type PreviewMeshExportCancelRequest = {
	type: 'export-cancel';
	id: number;
	exportId: number;
};

export type PreviewMeshWorkerRequest =
	| PreviewMeshBuildRequest
	| PreviewMeshExportStartRequest
	| PreviewMeshExportContinueRequest
	| PreviewMeshExportCancelRequest;

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

export type PreviewMeshExportMessage =
	| { type: 'export-started'; id: number; exportId: number; totalLayers: number }
	| {
			type: 'export-layer';
			id: number;
			exportId: number;
			layerNumber: number;
			totalLayers: number;
			png: ArrayBuffer;
	  }
	| {
			type: 'export-complete';
			id: number;
			exportId: number;
			totalLayers: number;
			volumeCubicMm: number;
	  }
	| { type: 'export-error'; id: number; exportId: number; message: string };

export type PreviewMeshWorkerMessage =
	| PreviewMeshProgressMessage
	| PreviewMeshResultMessage
	| PreviewMeshErrorMessage
	| PreviewMeshExportMessage;
