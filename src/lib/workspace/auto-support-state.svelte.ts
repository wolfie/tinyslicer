import type {
	AutoSupportRequest,
	AutoSupportWorkerMessage
} from '$lib/supports/auto-support-worker-types';
import type { AutoSupportDiagnostics } from '$lib/supports/generate-auto-supports';
import type { ModelRotation, ModelTranslation } from './build-volume-renderer/types';
import type { ImportedStlModel } from './stl-importer';
import type { ModelSurfaceHit } from './supports';

export type AutoSupportBuildStatus = 'idle' | 'building' | 'ready' | 'error';

export type AutoSupportBuildInput = {
	model: ImportedStlModel;
	translation: ModelTranslation;
	rotation: ModelRotation;
};

export type AutoSupportOutcome = {
	hits: ModelSurfaceHit[];
	diagnostics: AutoSupportDiagnostics;
};

function signatureFor(input: AutoSupportBuildInput): string {
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
		r.w
	].join('|');
}

async function defaultCreateWorker(): Promise<Worker> {
	const { default: AutoSupportWorker } = await import('$lib/supports/auto-support-worker?worker');
	return new AutoSupportWorker();
}

/**
 * Owns the off-main-thread first draft of automatic supports. It runs the same
 * conservative layer-mask scan as before, only in a worker, so entering the
 * Supports step stays responsive and can show progress. The resolved contacts are
 * handed back through the `onOutcome` callback rather than kept here, because the
 * workspace consumes them once to seed editable support points.
 */
export class AutoSupportBuild {
	status = $state<AutoSupportBuildStatus>('idle');
	progress = $state(0);
	error = $state<string | null>(null);

	#signature: string | null = null;
	#worker: Worker | null = null;
	#requestId = 0;
	#onOutcome: (outcome: AutoSupportOutcome) => void;
	#createWorker: () => Promise<Worker>;

	constructor(
		onOutcome: (outcome: AutoSupportOutcome) => void,
		createWorker: () => Promise<Worker> = defaultCreateWorker
	) {
		this.#onOutcome = onOutcome;
		this.#createWorker = createWorker;
	}

	request(input: AutoSupportBuildInput) {
		const signature = signatureFor(input);
		if (signature === this.#signature && (this.status === 'ready' || this.status === 'building')) {
			return;
		}
		// The default worker factory needs a real Worker (absent in SSR / node tests);
		// an injected factory brings its own environment.
		if (this.#createWorker === defaultCreateWorker && typeof Worker === 'undefined') return;

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
	}

	dispose() {
		this.#stopWorker();
	}

	async #spawn(input: AutoSupportBuildInput, requestId: number) {
		let worker: Worker;
		try {
			worker = await this.#createWorker();
		} catch {
			if (this.#requestId === requestId) {
				this.status = 'error';
				this.error = 'The automatic-support worker could not be started.';
			}
			return;
		}
		if (this.#requestId !== requestId) {
			worker.terminate();
			return;
		}

		this.#worker = worker;
		worker.onmessage = (event: MessageEvent<AutoSupportWorkerMessage>) =>
			this.#handleMessage(event.data, requestId);
		worker.onerror = () => {
			if (this.#requestId !== requestId) return;
			this.status = 'error';
			this.error = 'The automatic-support worker stopped unexpectedly.';
			this.#stopWorker();
		};

		const positions = input.model.positions.slice();
		const request: AutoSupportRequest = {
			id: requestId,
			positions,
			bounds: input.model.bounds,
			translation: { ...input.translation },
			rotation: { ...input.rotation }
		};
		worker.postMessage(request, [positions.buffer]);
	}

	#handleMessage(message: AutoSupportWorkerMessage, requestId: number) {
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
		this.#stopWorker();
		this.#onOutcome({ hits: message.hits, diagnostics: message.diagnostics });
	}

	#stopWorker() {
		if (!this.#worker) return;
		this.#worker.onmessage = null;
		this.#worker.onerror = null;
		this.#worker.terminate();
		this.#worker = null;
	}
}
