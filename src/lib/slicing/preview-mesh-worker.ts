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

/** Serves one layer's cached grayscale bytes, unpacked from the same buffer
 *  `emitNextLayer` slices for PNG export, so the scan preview matches it exactly. */
function sendLayerPixels(id: number, requestId: number, layerIndex: number) {
	const slice = cachedSlice;
	if (!slice || slice.id !== id) {
		post({
			type: 'layer-pixels-error',
			id,
			requestId,
			message: 'The cached slice is no longer available.'
		});
		return;
	}
	if (!Number.isInteger(layerIndex) || layerIndex < 0 || layerIndex >= slice.layerCount) {
		post({ type: 'layer-pixels-error', id, requestId, message: 'Layer index is out of range.' });
		return;
	}

	const pixelsPerLayer = slice.width * slice.height;
	const offset = layerIndex * pixelsPerLayer;
	// .slice() (not .subarray()) copies the bytes: the transfer below would
	// otherwise detach the shared buffer backing every other cached layer.
	const pixels = slice.layerPixels.slice(offset, offset + pixelsPerLayer);
	const buffer = pixels.buffer as ArrayBuffer;
	post(
		{
			type: 'layer-pixels',
			id,
			requestId,
			layerIndex,
			width: slice.width,
			height: slice.height,
			pixels: buffer
		},
		[buffer]
	);
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
	if (request.type === 'layer-pixels') {
		sendLayerPixels(request.id, request.requestId, request.layerIndex);
		return;
	}
	if (activeExport?.id === request.id && activeExport.exportId === request.exportId) {
		activeExport = null;
	}
};

function post(message: PreviewMeshWorkerMessage, transfer: Transferable[] = []) {
	worker.postMessage(message, transfer);
}
