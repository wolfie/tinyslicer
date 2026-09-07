import { PREVIEW_SUPERSAMPLE } from '$lib/slicing/layer-coverage';
import type {
	PreviewMeshBuildRequest,
	PreviewMeshWorkerMessage
} from '$lib/slicing/preview-mesh-worker-types';
import type { RaftIsland } from '$lib/supports/raft-plan';
import type { ModelRotation, ModelScale, ModelTranslation } from './build-volume-renderer/types';
import type { ImportedStlModel } from './stl-importer';
import type { SupportPlan } from './supports';

export type PreviewBuildStatus = 'idle' | 'building' | 'ready' | 'error';

export type PreviewMeshData = { positions: Float32Array; normals: Float32Array };
export type SliceStreamResult = { totalLayers: number; volumeCubicMm: number };
export type SliceLayerWriter = (
	layerNumber: number,
	totalLayers: number,
	png: ArrayBuffer
) => Promise<void>;
export type SliceLayerSource = {
	layerCount: number;
	streamPngLayers: (
		writeLayer: SliceLayerWriter,
		signal?: AbortSignal
	) => Promise<SliceStreamResult>;
};

export type PreviewBuildInput = {
	model: ImportedStlModel;
	translation: ModelTranslation;
	rotation: ModelRotation;
	scale?: ModelScale;
	supportPlan: SupportPlan;
	raftIslands: readonly RaftIsland[];
};

type PendingSliceStream = {
	exportId: number;
	writeLayer: SliceLayerWriter;
	resolve: (result: SliceStreamResult) => void;
	reject: (error: Error) => void;
	signal?: AbortSignal;
	onAbort?: () => void;
};

function signatureFor(input: PreviewBuildInput): string {
	const { translation: t, rotation: r } = input;
	return [
		input.model.name,
		input.model.triangleCount,
		input.model.byteLength,
		t.x,
		t.y,
		t.z,
		r.x,
		r.y,
		r.z,
		r.w,
		input.scale ?? 1,
		input.supportPlan.structures.map((structure) => structure.id).join(','),
		input.raftIslands
			.map(
				(island) =>
					`${island.id}:${island.supportPointIds.join('.')}:${island.core.length}:${island.brimWidthMm.toFixed(3)}`
			)
			.join(','),
		PREVIEW_SUPERSAMPLE
	].join('|');
}

async function defaultCreateWorker(): Promise<Worker> {
	const { default: PreviewMeshWorker } = await import('$lib/slicing/preview-mesh-worker?worker');
	return new PreviewMeshWorker();
}

/**
 * Owns one canonical off-main-thread slice. The worker retains its quantized
 * layers after building the preview mesh and PNG-encodes those same layers on
 * demand, so exporting never rasterizes the model a second time.
 */
export class PreviewBuild implements SliceLayerSource {
	status = $state<PreviewBuildStatus>('idle');
	progress = $state(0);
	error = $state<string | null>(null);
	mesh = $state.raw<PreviewMeshData | null>(null);
	layerCount = $state(0);
	zHeightMm = $state(0);
	watertight = $state(true);

	#signature: string | null = null;
	#worker: Worker | null = null;
	#requestId = 0;
	#exportId = 0;
	#pendingStream: PendingSliceStream | null = null;
	#createWorker: () => Promise<Worker>;

	constructor(createWorker: () => Promise<Worker> = defaultCreateWorker) {
		this.#createWorker = createWorker;
	}

	request(input: PreviewBuildInput) {
		const signature = signatureFor(input);
		if (
			signature === this.#signature &&
			this.#worker &&
			(this.status === 'ready' || this.status === 'building')
		) {
			return;
		}
		if (this.#createWorker === defaultCreateWorker && typeof Worker === 'undefined') return;

		this.#stopWorker();
		this.#signature = signature;
		const requestId = ++this.#requestId;
		this.status = 'building';
		this.progress = 0;
		this.error = null;
		void this.#spawn(input, requestId);
	}

	/** Streams PNGs encoded from the cached preview layers without slicing again. */
	streamPngLayers(writeLayer: SliceLayerWriter, signal?: AbortSignal): Promise<SliceStreamResult> {
		if (this.status !== 'ready' || !this.#worker) {
			return Promise.reject(new Error('The cached slice is not ready.'));
		}
		if (this.#pendingStream) {
			return Promise.reject(new Error('The cached slice is already being exported.'));
		}
		if (signal?.aborted) return Promise.reject(new Error('The export was cancelled.'));

		const exportId = ++this.#exportId;
		return new Promise<SliceStreamResult>((resolve, reject) => {
			const pending: PendingSliceStream = { exportId, writeLayer, resolve, reject, signal };
			if (signal) {
				pending.onAbort = () => this.#cancelStream(new Error('The export was cancelled.'));
				signal.addEventListener('abort', pending.onAbort, { once: true });
			}
			this.#pendingStream = pending;
			this.#worker?.postMessage({ type: 'export-start', id: this.#requestId, exportId });
		});
	}

	reset() {
		this.#stopWorker();
		this.#signature = null;
		this.#requestId += 1;
		this.status = 'idle';
		this.progress = 0;
		this.error = null;
		this.mesh = null;
		this.layerCount = 0;
		this.zHeightMm = 0;
		this.watertight = true;
	}

	dispose() {
		this.#stopWorker();
	}

	async #spawn(input: PreviewBuildInput, requestId: number) {
		let worker: Worker;
		try {
			worker = await this.#createWorker();
		} catch {
			if (this.#requestId === requestId) {
				this.status = 'error';
				this.error = 'The preview worker could not be started.';
			}
			return;
		}
		if (this.#requestId !== requestId) {
			worker.terminate();
			return;
		}

		this.#worker = worker;
		worker.onmessage = (event: MessageEvent<PreviewMeshWorkerMessage>) =>
			this.#handleMessage(event.data, requestId);
		worker.onerror = () => {
			if (this.#requestId !== requestId) return;
			this.status = 'error';
			this.error = 'The slice worker stopped unexpectedly.';
			this.mesh = null;
			this.#stopWorker();
		};

		const positions = input.model.positions.slice();
		const request: PreviewMeshBuildRequest = {
			type: 'build',
			id: requestId,
			positions,
			bounds: input.model.bounds,
			translation: { ...input.translation },
			rotation: { ...input.rotation },
			scale: input.scale ?? 1,
			supportPlan: input.supportPlan,
			raftIslands: input.raftIslands
		};
		worker.postMessage(request, [positions.buffer]);
	}

	#handleMessage(message: PreviewMeshWorkerMessage, requestId: number) {
		if (message.id !== requestId || this.#requestId !== requestId) return;
		if ('exportId' in message) {
			this.#handleExportMessage(message);
			return;
		}

		if (message.type === 'progress') {
			this.progress = message.total > 0 ? message.completed / message.total : 0;
			return;
		}
		if (message.type === 'error') {
			this.status = 'error';
			this.error = message.message;
			this.#stopWorker();
			return;
		}

		this.mesh = { positions: message.positions, normals: message.normals };
		this.layerCount = message.layerCount;
		this.zHeightMm = message.zHeightMm;
		this.watertight = message.meshIsWatertightAtPixelSamples;
		this.progress = 1;
		this.status = 'ready';
	}

	#handleExportMessage(message: Extract<PreviewMeshWorkerMessage, { exportId: number }>) {
		const pending = this.#pendingStream;
		if (!pending || message.exportId !== pending.exportId) return;
		if (message.type === 'export-started') return;
		if (message.type === 'export-error') {
			this.#rejectStream(new Error(message.message));
			return;
		}
		if (message.type === 'export-complete') {
			this.#finishStream({
				totalLayers: message.totalLayers,
				volumeCubicMm: message.volumeCubicMm
			});
			return;
		}

		void (async () => {
			try {
				await pending.writeLayer(message.layerNumber, message.totalLayers, message.png);
				if (this.#pendingStream !== pending) return;
				this.#worker?.postMessage({
					type: 'export-continue',
					id: this.#requestId,
					exportId: pending.exportId
				});
			} catch (error) {
				this.#cancelStream(
					error instanceof Error ? error : new Error('A project layer could not be written.')
				);
			}
		})();
	}

	#finishStream(result: SliceStreamResult) {
		const pending = this.#takePendingStream();
		pending?.resolve(result);
	}

	#rejectStream(error: Error) {
		const pending = this.#takePendingStream();
		pending?.reject(error);
	}

	#cancelStream(error: Error) {
		const pending = this.#pendingStream;
		if (!pending) return;
		this.#worker?.postMessage({
			type: 'export-cancel',
			id: this.#requestId,
			exportId: pending.exportId
		});
		this.#rejectStream(error);
	}

	#takePendingStream(): PendingSliceStream | null {
		const pending = this.#pendingStream;
		this.#pendingStream = null;
		if (pending?.signal && pending.onAbort) {
			pending.signal.removeEventListener('abort', pending.onAbort);
		}
		return pending;
	}

	#stopWorker() {
		this.#rejectStream(new Error('The cached slice is no longer available.'));
		if (!this.#worker) return;
		this.#worker.onmessage = null;
		this.#worker.onerror = null;
		this.#worker.terminate();
		this.#worker = null;
	}
}
