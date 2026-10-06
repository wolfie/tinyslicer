import { describe, expect, it, vi } from 'vitest';

import type {
	PreviewMeshWorkerMessage,
	PreviewMeshWorkerRequest
} from '$lib/slicing/preview-mesh-worker-types';
import { PreviewBuild, type PreviewBuildInput } from './preview-state.svelte';

class StubSliceWorker {
	onmessage: ((event: MessageEvent<PreviewMeshWorkerMessage>) => void) | null = null;
	onerror: ((event: ErrorEvent) => void) | null = null;
	requests: PreviewMeshWorkerRequest[] = [];
	terminated = false;
	#nextLayer = 1;

	postMessage(request: PreviewMeshWorkerRequest) {
		this.requests.push(request);
		if (request.type === 'build') {
			queueMicrotask(() =>
				this.#emit({
					type: 'result',
					id: request.id,
					positions: new Float32Array(9),
					normals: new Float32Array(9),
					triangleCount: 1,
					layerCount: 2,
					zHeightMm: 0.1,
					volumeCubicMm: 12.5,
					meshIsWatertightAtPixelSamples: true
				})
			);
			return;
		}
		if (request.type === 'export-start') {
			this.#nextLayer = 1;
			queueMicrotask(() => {
				this.#emit({
					type: 'export-started',
					id: request.id,
					exportId: request.exportId,
					totalLayers: 2
				});
				this.#emitLayer(request.id, request.exportId);
			});
			return;
		}
		if (request.type === 'export-continue') {
			queueMicrotask(() => this.#emitLayer(request.id, request.exportId));
		}
		if (request.type === 'layer-pixels') {
			queueMicrotask(() => {
				if (request.layerIndex < 0 || request.layerIndex >= 2) {
					this.#emit({
						type: 'layer-pixels-error',
						id: request.id,
						requestId: request.requestId,
						message: 'Layer index is out of range.'
					});
					return;
				}
				const pixels = Uint8Array.of(request.layerIndex, request.layerIndex);
				this.#emit({
					type: 'layer-pixels',
					id: request.id,
					requestId: request.requestId,
					layerIndex: request.layerIndex,
					width: 2,
					height: 1,
					pixels: pixels.buffer
				});
			});
		}
	}

	terminate() {
		this.terminated = true;
	}

	#emitLayer(id: number, exportId: number) {
		if (this.#nextLayer > 2) {
			this.#emit({
				type: 'export-complete',
				id,
				exportId,
				totalLayers: 2,
				volumeCubicMm: 12.5
			});
			return;
		}
		this.#emit({
			type: 'export-layer',
			id,
			exportId,
			layerNumber: this.#nextLayer,
			totalLayers: 2,
			png: Uint8Array.of(this.#nextLayer++).buffer
		});
	}

	#emit(message: PreviewMeshWorkerMessage) {
		this.onmessage?.({ data: message } as MessageEvent<PreviewMeshWorkerMessage>);
	}
}

function input(): PreviewBuildInput {
	return {
		model: {
			name: 'cube.stl',
			format: 'Binary',
			positions: new Float32Array(9),
			normals: new Float32Array(9),
			bounds: { min: { x: 0, y: 0, z: 0 }, max: { x: 1, y: 1, z: 1 } },
			dimensions: { x: 1, y: 1, z: 1 },
			triangleCount: 1,
			byteLength: 84
		},
		translation: { x: 0, y: 0, z: 0 },
		rotation: { x: 0, y: 0, z: 0, w: 1 },
		supportPlan: { structures: [], unresolvedPoints: [] },
		raftIslands: []
	};
}

describe('PreviewBuild cached slice', () => {
	it('builds once and streams the cached layers for repeated exports', async () => {
		const worker = new StubSliceWorker();
		const preview = new PreviewBuild(async () => worker as unknown as Worker);
		preview.request(input());
		await vi.waitFor(() => expect(preview.status).toBe('ready'));

		const firstLayers: number[] = [];
		expect(preview.volumeCubicMm).toBe(12.5);
		await expect(
			preview.streamPngLayers(async (layerNumber) => {
				firstLayers.push(layerNumber);
			})
		).resolves.toEqual({ totalLayers: 2, volumeCubicMm: 12.5 });
		const secondLayers: number[] = [];
		await preview.streamPngLayers(async (layerNumber) => {
			secondLayers.push(layerNumber);
		});

		expect(firstLayers).toEqual([1, 2]);
		expect(secondLayers).toEqual([1, 2]);
		expect(worker.requests.filter((request) => request.type === 'build')).toHaveLength(1);
		expect(worker.terminated).toBe(false);
	});

	it('releases the cached layers when reset', async () => {
		const worker = new StubSliceWorker();
		const preview = new PreviewBuild(async () => worker as unknown as Worker);
		preview.request(input());
		await vi.waitFor(() => expect(preview.status).toBe('ready'));

		preview.reset();

		expect(worker.terminated).toBe(true);
		expect(preview.status).toBe('idle');
		expect(preview.volumeCubicMm).toBe(0);
		await expect(preview.streamPngLayers(async () => {})).rejects.toThrow(/not ready/);
	});
});

describe('PreviewBuild.layerPixels', () => {
	it('fetches the cached bytes for one layer without rebuilding', async () => {
		const worker = new StubSliceWorker();
		const preview = new PreviewBuild(async () => worker as unknown as Worker);
		preview.request(input());
		await vi.waitFor(() => expect(preview.status).toBe('ready'));

		const image = await preview.layerPixels(1);

		expect(image).toEqual({ width: 2, height: 1, pixels: Uint8Array.of(1, 1) });
		expect(worker.requests.filter((request) => request.type === 'build')).toHaveLength(1);
	});

	it('rejects an out-of-range layer index', async () => {
		const worker = new StubSliceWorker();
		const preview = new PreviewBuild(async () => worker as unknown as Worker);
		preview.request(input());
		await vi.waitFor(() => expect(preview.status).toBe('ready'));

		await expect(preview.layerPixels(5)).rejects.toThrow(/out of range/);
	});

	it('rejects once the cached slice is reset', async () => {
		const worker = new StubSliceWorker();
		const preview = new PreviewBuild(async () => worker as unknown as Worker);
		preview.request(input());
		await vi.waitFor(() => expect(preview.status).toBe('ready'));

		const pending = preview.layerPixels(0);
		preview.reset();

		await expect(pending).rejects.toThrow(/not ready|no longer available/);
	});

	it('rejects immediately when the slice is not ready', async () => {
		const worker = new StubSliceWorker();
		const preview = new PreviewBuild(async () => worker as unknown as Worker);

		await expect(preview.layerPixels(0)).rejects.toThrow(/not ready/);
	});
});
