import type { RaftIsland } from '$lib/supports/raft-plan';
import type { ModelRotation, ModelTranslation } from '$lib/workspace/build-volume-renderer/types';
import type { Bounds3 } from '$lib/workspace/stl-importer';
import type { SupportPlan } from '$lib/workspace/supports';

export type ExportSliceStartRequest = {
	type: 'start';
	id: number;
	positions: Float32Array;
	bounds: Bounds3;
	translation: ModelTranslation;
	rotation: ModelRotation;
	supportPlan: SupportPlan;
	raftIslands: readonly RaftIsland[];
};

export type ExportSliceContinueRequest = { type: 'continue'; id: number };
export type ExportSliceCancelRequest = { type: 'cancel'; id: number };
export type ExportSliceWorkerRequest =
	ExportSliceStartRequest | ExportSliceContinueRequest | ExportSliceCancelRequest;

export type ExportSliceWorkerMessage =
	| { type: 'started'; id: number; totalLayers: number }
	| {
			type: 'layer';
			id: number;
			layerNumber: number;
			totalLayers: number;
			png: ArrayBuffer;
	  }
	| { type: 'complete'; id: number; totalLayers: number; volumeCubicMm: number }
	| { type: 'error'; id: number; message: string };
