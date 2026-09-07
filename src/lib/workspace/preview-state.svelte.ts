import { PREVIEW_SUPERSAMPLE } from '$lib/slicing/layer-coverage';
import type {
	PreviewMeshRequest,
	PreviewMeshWorkerMessage
} from '$lib/slicing/preview-mesh-worker-types';
import type { RaftIsland } from '$lib/supports/raft-plan';
import type { ModelRotation, ModelScale, ModelTranslation } from './build-volume-renderer/types';
import type { ImportedStlModel } from './stl-importer';
import type { SupportPlan } from './supports';

export type PreviewBuildStatus = 'idle' | 'building' | 'ready' | 'error';

export type PreviewMeshData = { positions: Float32Array; normals: Float32Array };

export type PreviewBuildInput = {
	model: ImportedStlModel;
	translation: ModelTranslation;
	rotation: ModelRotation;
	scale?: ModelScale;
	supportPlan: SupportPlan;
	raftIslands: readonly RaftIsland[];
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
 * Owns the off-main-thread reconstruction of the sliced preview mesh. Rebuilds
 * only when the scene signature (model, transform, resolved supports) changes and
 * caches the last ready mesh so re-entering the Preview step is instant.
 */
export class PreviewBuild {
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
	#createWorker: () => Promise<Worker>;

	constructor(createWorker: () => Promise<Worker> = defaultCreateWorker) {
		this.#createWorker = createWorker;
	}

	request(input: PreviewBuildInput) {
		const signature = signatureFor(input);
		if (signature === this.#signature && (this.status === 'ready' || this.status === 'building')) {
			return;
		}
		if (typeof Worker === 'undefined') return;

		this.#stopWorker();
		this.#signature = signature;
		const requestId = ++this.#requestId;
		this.status = 'building';
		this.progress = 0;
		this.error = null;
		void this.#spawn(input, requestId);
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
			this.error = 'The preview worker stopped unexpectedly.';
			this.#stopWorker();
		};

		const positions = input.model.positions.slice();
		const request: PreviewMeshRequest = {
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
		this.#stopWorker();
	}

	#stopWorker() {
		if (!this.#worker) return;
		this.#worker.onmessage = null;
		this.#worker.onerror = null;
		this.#worker.terminate();
		this.#worker = null;
	}
}
