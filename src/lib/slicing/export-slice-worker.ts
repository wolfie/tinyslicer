/// <reference lib="webworker" />

import { encodeGrayscalePng } from './grayscale-png';
import { LayerCoverageRasterizer } from './layer-coverage';
import type {
	ExportSliceStartRequest,
	ExportSliceWorkerMessage,
	ExportSliceWorkerRequest
} from './export-slice-worker-types';

type ActiveSlice = {
	id: number;
	rasterizer: LayerCoverageRasterizer;
	nextLayerIndex: number;
	volumeCubicMm: number;
	busy: boolean;
};

const worker = self as unknown as DedicatedWorkerGlobalScope;
let active: ActiveSlice | null = null;

function post(message: ExportSliceWorkerMessage, transfer: Transferable[] = []) {
	worker.postMessage(message, transfer);
}

function start(request: ExportSliceStartRequest) {
	const rasterizer = new LayerCoverageRasterizer(
		{ positions: request.positions, bounds: request.bounds },
		request.translation,
		request.rotation,
		request.supportPlan,
		request.raftIslands
	);
	active = { id: request.id, rasterizer, nextLayerIndex: 0, volumeCubicMm: 0, busy: false };
	post({ type: 'started', id: request.id, totalLayers: rasterizer.layerCount });
	void emitNextLayer();
}

async function emitNextLayer() {
	const slice = active;
	if (!slice || slice.busy) return;
	if (slice.nextLayerIndex >= slice.rasterizer.layerCount) {
		post({
			type: 'complete',
			id: slice.id,
			totalLayers: slice.rasterizer.layerCount,
			volumeCubicMm: slice.volumeCubicMm
		});
		active = null;
		return;
	}

	slice.busy = true;
	try {
		const mask = slice.rasterizer.coverageMask(slice.nextLayerIndex);
		const pixels = new Uint8Array(mask.data.length);
		let coverage = 0;
		for (let index = 0; index < mask.data.length; index += 1) {
			coverage += mask.data[index];
			pixels[index] = Math.round(mask.data[index] * 255);
		}
		slice.volumeCubicMm +=
			coverage *
			slice.rasterizer.pixelPitchMm.x *
			slice.rasterizer.pixelPitchMm.y *
			slice.rasterizer.layerHeightMm;
		const png = await encodeGrayscalePng(mask.width, mask.height, pixels);
		if (active !== slice) return;
		const layerNumber = slice.nextLayerIndex + 1;
		slice.nextLayerIndex += 1;
		slice.busy = false;
		const pngBuffer = png.buffer as ArrayBuffer;
		post(
			{
				type: 'layer',
				id: slice.id,
				layerNumber,
				totalLayers: slice.rasterizer.layerCount,
				png: pngBuffer
			},
			[pngBuffer]
		);
	} catch (error) {
		if (active !== slice) return;
		post({
			type: 'error',
			id: slice.id,
			message: error instanceof Error ? error.message : 'Layer generation failed.'
		});
		active = null;
	}
}

worker.onmessage = (event: MessageEvent<ExportSliceWorkerRequest>) => {
	const request = event.data;
	if (request.type === 'cancel') {
		if (active?.id === request.id) active = null;
		return;
	}
	if (request.type === 'continue') {
		if (active?.id === request.id) void emitNextLayer();
		return;
	}

	try {
		start(request);
	} catch (error) {
		post({
			type: 'error',
			id: request.id,
			message: error instanceof Error ? error.message : 'Slicing could not start.'
		});
		active = null;
	}
};
