import type { SupportTopologyAnalysis } from '$lib/supports/analyze-support-topology';
import type {
	SupportAnalysisRequest,
	SupportAnalysisWorkerMessage
} from '$lib/supports/support-analysis-worker-types';
import type { RaftIsland } from '$lib/supports/raft-plan';
import type { ModelRotation, ModelScale, ModelTranslation } from './build-volume-renderer/types';
import type { ImportedStlModel } from './stl-importer';
import type { SupportPlan, SupportPoint } from './supports';

export type SupportAnalysisStatus = 'idle' | 'building' | 'ready' | 'error';

export type SupportAnalysisInput = {
	model: ImportedStlModel;
	translation: ModelTranslation;
	rotation: ModelRotation;
	scale: ModelScale;
	supportPlan: SupportPlan;
	supportPoints: readonly SupportPoint[];
	raftIslands: readonly RaftIsland[];
};

const ANALYSIS_DEBOUNCE_MS = 180;

async function defaultCreateWorker(): Promise<Worker> {
	const { default: SupportAnalysisWorker } =
		await import('$lib/supports/support-analysis-worker?worker');
	return new SupportAnalysisWorker();
}

/** Debounced worker audit of print connectivity, contact coverage, and shaft stability. */
export class SupportAnalysisBuild {
	status = $state<SupportAnalysisStatus>('idle');
	progress = $state(0);
	error = $state<string | null>(null);
	result = $state.raw<SupportTopologyAnalysis | null>(null);

	#worker: Worker | null = null;
	#requestId = 0;
	#timer: ReturnType<typeof setTimeout> | null = null;
	#createWorker: () => Promise<Worker>;
	#onResult: () => void;

	constructor(
		createWorker: () => Promise<Worker> = defaultCreateWorker,
		onResult: () => void = () => {}
	) {
		this.#createWorker = createWorker;
		this.#onResult = onResult;
	}

	request(input: SupportAnalysisInput) {
		if (this.#createWorker === defaultCreateWorker && typeof Worker === 'undefined') return;
		this.#cancelPending();
		this.#stopWorker();
		const requestId = ++this.#requestId;
		this.status = 'building';
		this.progress = 0;
		this.error = null;
		this.result = null;
		this.#timer = setTimeout(() => {
			this.#timer = null;
			void this.#spawn(input, requestId);
		}, ANALYSIS_DEBOUNCE_MS);
	}

	reset() {
		this.#cancelPending();
		this.#stopWorker();
		this.#requestId += 1;
		this.status = 'idle';
		this.progress = 0;
		this.error = null;
		this.result = null;
	}

	dispose() {
		this.#cancelPending();
		this.#stopWorker();
	}

	async #spawn(input: SupportAnalysisInput, requestId: number) {
		let worker: Worker;
		try {
			worker = await this.#createWorker();
		} catch {
			if (this.#requestId === requestId) {
				this.status = 'error';
				this.error = 'The support-analysis worker could not be started.';
			}
			return;
		}
		if (this.#requestId !== requestId) {
			worker.terminate();
			return;
		}

		this.#worker = worker;
		worker.onmessage = (event: MessageEvent<SupportAnalysisWorkerMessage>) =>
			this.#handleMessage(event.data, requestId);
		worker.onerror = () => {
			if (this.#requestId !== requestId) return;
			this.status = 'error';
			this.error = 'The support-analysis worker stopped unexpectedly.';
			this.#stopWorker();
		};

		const positions = input.model.positions.slice();
		const request: SupportAnalysisRequest = {
			id: requestId,
			positions,
			bounds: input.model.bounds,
			translation: { ...input.translation },
			rotation: { ...input.rotation },
			scale: input.scale,
			supportPlan: input.supportPlan,
			supportPoints: input.supportPoints,
			raftIslands: input.raftIslands
		};
		worker.postMessage(request, [positions.buffer]);
	}

	#handleMessage(message: SupportAnalysisWorkerMessage, requestId: number) {
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
		this.progress = 1;
		this.status = 'ready';
		this.result = message.analysis;
		this.#stopWorker();
		this.#onResult();
	}

	#cancelPending() {
		if (this.#timer === null) return;
		clearTimeout(this.#timer);
		this.#timer = null;
	}

	#stopWorker() {
		if (!this.#worker) return;
		this.#worker.onmessage = null;
		this.#worker.onerror = null;
		this.#worker.terminate();
		this.#worker = null;
	}
}
