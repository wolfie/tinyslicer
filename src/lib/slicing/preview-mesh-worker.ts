/// <reference lib="webworker" />

import { buildPreviewMesh } from './preview-mesh';
import { encodeGrayscalePng } from './grayscale-png';
import type {
	PreviewMeshBuildRequest,
	PreviewMeshWorkerMessage,
	PreviewMeshWorkerRequest
} from './preview-mesh-worker-types';

type CachedSlice = {
	id: number;
	width: number;
	height: number;
	layerCount: number;
	layerPixels: Uint8Array;
	volumeCubicMm: number;
};

type ActiveExport = { id: number; exportId: number; nextLayerIndex: number; busy: boolean };

const worker = self as unknown as DedicatedWorkerGlobalScope;
let cachedSlice: CachedSlice | null = null;
let activeExport: ActiveExport | null = null;

function build(request: PreviewMeshBuildRequest) {
	activeExport = null;
	cachedSlice = null;
	try {
		const result = buildPreviewMesh(
			{
				model: { positions: request.positions, bounds: request.bounds },
				translation: request.translation,
				rotation: request.rotation,
				scale: request.scale,
				supportPlan: request.supportPlan,
				raftIslands: request.raftIslands
			},
			(completed, total) => {
				post({ type: 'progress', id: request.id, completed, total });
			}
		);
		cachedSlice = {
			id: request.id,
			width: result.width,
			height: result.height,
			layerCount: result.layerCount,
			layerPixels: result.layerPixels,
			volumeCubicMm: result.volumeCubicMm
		};
		post(
			{
				type: 'result',
				id: request.id,
				positions: result.positions,
				normals: result.normals,
				triangleCount: result.triangleCount,
				layerCount: result.layerCount,
				zHeightMm: result.zHeightMm,
				meshIsWatertightAtPixelSamples: result.meshIsWatertightAtPixelSamples
			},
			[result.positions.buffer, result.normals.buffer]
		);
	} catch (error) {
		post({
			type: 'error',
			id: request.id,
			message: error instanceof Error ? error.message : 'Preview generation failed.'
		});
	}
}

function startExport(id: number, exportId: number) {
	const slice = cachedSlice;
	if (!slice || slice.id !== id) {
		post({
			type: 'export-error',
			id,
			exportId,
			message: 'The cached slice is no longer available.'
		});
		return;
	}
	activeExport = { id, exportId, nextLayerIndex: 0, busy: false };
	post({ type: 'export-started', id, exportId, totalLayers: slice.layerCount });
	void emitNextLayer();
}

async function emitNextLayer() {
	const job = activeExport;
	const slice = cachedSlice;
	if (!job || !slice || job.busy || slice.id !== job.id) return;
	if (job.nextLayerIndex >= slice.layerCount) {
		post({
			type: 'export-complete',
			id: job.id,
			exportId: job.exportId,
			totalLayers: slice.layerCount,
			volumeCubicMm: slice.volumeCubicMm
		});
		activeExport = null;
		return;
	}

	job.busy = true;
	try {
		const pixelsPerLayer = slice.width * slice.height;
		const offset = job.nextLayerIndex * pixelsPerLayer;
		const pixels = slice.layerPixels.subarray(offset, offset + pixelsPerLayer);
		const png = await encodeGrayscalePng(slice.width, slice.height, pixels);
		if (activeExport !== job) return;
		const layerNumber = job.nextLayerIndex + 1;
		job.nextLayerIndex += 1;
		job.busy = false;
		const pngBuffer = png.buffer as ArrayBuffer;
		post(
			{
				type: 'export-layer',
				id: job.id,
				exportId: job.exportId,
				layerNumber,
				totalLayers: slice.layerCount,
				png: pngBuffer
			},
			[pngBuffer]
		);
	} catch (error) {
		if (activeExport !== job) return;
		post({
			type: 'export-error',
			id: job.id,
			exportId: job.exportId,
			message: error instanceof Error ? error.message : 'Layer image generation failed.'
		});
		activeExport = null;
	}
}

worker.onmessage = (event: MessageEvent<PreviewMeshWorkerRequest>) => {
	const request = event.data;
	if (request.type === 'build') {
		build(request);
		return;
	}
	if (request.type === 'export-start') {
		startExport(request.id, request.exportId);
		return;
	}
	if (request.type === 'export-continue') {
		if (activeExport?.id === request.id && activeExport.exportId === request.exportId) {
			void emitNextLayer();
		}
		return;
	}
	if (activeExport?.id === request.id && activeExport.exportId === request.exportId) {
		activeExport = null;
	}
};

function post(message: PreviewMeshWorkerMessage, transfer: Transferable[] = []) {
	worker.postMessage(message, transfer);
}
