import type {
	ExportSliceWorkerMessage,
	ExportSliceWorkerRequest
} from '$lib/slicing/export-slice-worker-types';
import { createTinyMakerGcode, validateProjectName } from '$lib/slicing/tinymaker-project';
import { StoredZipArchive } from '$lib/slicing/zip-archive';
import type { RaftIsland } from '$lib/supports/raft-plan';
import type { ModelRotation, ModelTranslation } from './build-volume-renderer/types';
import type { ImportedStlModel } from './stl-importer';
import type { SupportPlan } from './supports';
import { createNewProjectDirectory, writeNewProjectFile } from './project-files';
import { renderProjectPreviews } from './project-preview';
import type { PreviewMeshData } from './preview-state.svelte';

export type ProjectExportStatus = 'idle' | 'picking' | 'slicing' | 'saved' | 'error';
export type ProjectExportMode = 'directory' | 'archive';

export type ProjectExportInput = {
	model: ImportedStlModel;
	translation: ModelTranslation;
	rotation: ModelRotation;
	supportPlan: SupportPlan;
	raftIslands: readonly RaftIsland[];
	previewMesh: PreviewMeshData;
};

type DirectoryPicker = (options?: {
	id?: string;
	mode?: 'read' | 'readwrite';
}) => Promise<FileSystemDirectoryHandle>;

export type ProjectExportOptions = {
	chooseDirectory?: DirectoryPicker;
	createWorker?: () => Promise<Worker>;
	renderPreviews?: typeof renderProjectPreviews;
	downloadFile?: (blob: Blob, filename: string) => void;
};

async function defaultCreateWorker(): Promise<Worker> {
	const { default: ExportSliceWorker } = await import('$lib/slicing/export-slice-worker?worker');
	return new ExportSliceWorker();
}

function defaultDirectoryPicker(options?: Parameters<DirectoryPicker>[0]) {
	return window.showDirectoryPicker(options);
}

function defaultDownloadFile(blob: Blob, filename: string) {
	const url = URL.createObjectURL(blob);
	const anchor = document.createElement('a');
	anchor.href = url;
	anchor.download = filename;
	anchor.hidden = true;
	document.body.append(anchor);
	anchor.click();
	anchor.remove();
	setTimeout(() => URL.revokeObjectURL(url), 0);
}

function isPickerCancellation(error: unknown): boolean {
	return error instanceof DOMException && error.name === 'AbortError';
}

export class ProjectExport {
	status = $state<ProjectExportStatus>('idle');
	mode = $state<ProjectExportMode | null>(null);
	progress = $state(0);
	completedLayers = $state(0);
	totalLayers = $state(0);
	error = $state<string | null>(null);
	savedPath = $state<string | null>(null);
	downloadedFilename = $state<string | null>(null);
	partialProjectPath = $state<string | null>(null);

	#chooseDirectory: DirectoryPicker;
	#createWorker: () => Promise<Worker>;
	#renderPreviews: typeof renderProjectPreviews;
	#downloadFile: (blob: Blob, filename: string) => void;
	#worker: Worker | null = null;
	#pendingResolve: ((result: boolean) => void) | null = null;
	#requestId = 0;

	constructor(options: ProjectExportOptions = {}) {
		this.#chooseDirectory = options.chooseDirectory ?? defaultDirectoryPicker;
		this.#createWorker = options.createWorker ?? defaultCreateWorker;
		this.#renderPreviews = options.renderPreviews ?? renderProjectPreviews;
		this.#downloadFile = options.downloadFile ?? defaultDownloadFile;
	}

	get archiveSupported(): boolean {
		return (
			typeof window !== 'undefined' &&
			typeof document !== 'undefined' &&
			typeof CompressionStream !== 'undefined' &&
			typeof URL !== 'undefined' &&
			typeof URL.createObjectURL === 'function'
		);
	}

	get directorySupported(): boolean {
		return this.archiveSupported && window.isSecureContext && 'showDirectoryPicker' in window;
	}

	get supported(): boolean {
		return this.archiveSupported;
	}

	async start(input: ProjectExportInput, projectName: string): Promise<boolean> {
		if (this.status === 'picking' || this.status === 'slicing') return false;
		const nameError = validateProjectName(projectName);
		if (nameError) {
			this.#fail(nameError);
			return false;
		}
		if (!this.directorySupported && this.#chooseDirectory === defaultDirectoryPicker) {
			this.#fail('Direct folder export requires a Chromium-based browser in a secure context.');
			return false;
		}

		this.reset();
		const requestId = this.#requestId;
		this.mode = 'directory';
		this.status = 'picking';
		let parent: FileSystemDirectoryHandle;
		try {
			// This must be the first awaited operation so the native picker retains
			// the button click's transient user activation.
			parent = await this.#chooseDirectory({ id: 'tinyslicer-project-export', mode: 'readwrite' });
			if (this.#requestId !== requestId) return false;
		} catch (error) {
			if (isPickerCancellation(error)) {
				this.status = 'idle';
				return false;
			}
			this.#fail(
				error instanceof Error ? error.message : 'The destination folder could not be opened.'
			);
			return false;
		}

		let directory: FileSystemDirectoryHandle;
		try {
			directory = await createNewProjectDirectory(parent, projectName);
			if (this.#requestId !== requestId) return false;
			this.partialProjectPath = `${parent.name}/${projectName}`;
			this.status = 'slicing';
			const previews = await this.#renderPreviews(input.previewMesh);
			if (this.#requestId !== requestId) return false;
			await writeNewProjectFile(directory, 'preview.png', previews.preview);
			if (this.#requestId !== requestId) return false;
			await writeNewProjectFile(directory, 'preview_cropping.png', previews.cropped);
			if (this.#requestId !== requestId) return false;
			return await this.#sliceLayers(
				input,
				requestId,
				(layerNumber, png) => writeNewProjectFile(directory, `${layerNumber}.png`, png),
				async (message) => {
					await writeNewProjectFile(directory, 'run.gcode', this.#createGcode(input, message));
					this.savedPath = `${parent.name}/${projectName}`;
					this.partialProjectPath = null;
				}
			);
		} catch (error) {
			this.#fail(
				error instanceof Error ? error.message : 'The print project could not be written.'
			);
			return false;
		}
	}

	async downloadArchive(input: ProjectExportInput, projectName: string): Promise<boolean> {
		if (this.status === 'picking' || this.status === 'slicing') return false;
		const nameError = validateProjectName(projectName);
		if (nameError) {
			this.#fail(nameError);
			return false;
		}
		if (!this.archiveSupported && this.#downloadFile === defaultDownloadFile) {
			this.#fail('ZIP export requires a browser with Compression Streams support.');
			return false;
		}

		this.reset();
		const requestId = this.#requestId;
		this.mode = 'archive';
		this.status = 'slicing';
		const archive = new StoredZipArchive();
		const prefix = `${projectName}/`;

		try {
			const previews = await this.#renderPreviews(input.previewMesh);
			if (this.#requestId !== requestId) return false;
			await archive.add(`${prefix}preview.png`, previews.preview);
			await archive.add(`${prefix}preview_cropping.png`, previews.cropped);
			return await this.#sliceLayers(
				input,
				requestId,
				(layerNumber, png) => archive.add(`${prefix}${layerNumber}.png`, png),
				async (message) => {
					await archive.add(`${prefix}run.gcode`, this.#createGcode(input, message));
					const filename = `${projectName}.zip`;
					this.#downloadFile(archive.toBlob(), filename);
					this.downloadedFilename = filename;
				}
			);
		} catch (error) {
			this.#fail(
				error instanceof Error ? error.message : 'The print project archive could not be created.'
			);
			return false;
		}
	}

	reset() {
		this.#stopWorker();
		this.status = 'idle';
		this.mode = null;
		this.progress = 0;
		this.completedLayers = 0;
		this.totalLayers = 0;
		this.error = null;
		this.savedPath = null;
		this.downloadedFilename = null;
		this.partialProjectPath = null;
	}

	dispose() {
		this.#stopWorker();
	}

	async #sliceLayers(
		input: ProjectExportInput,
		requestId: number,
		writeLayer: (layerNumber: number, png: ArrayBuffer) => Promise<void>,
		completeProject: (
			message: Extract<ExportSliceWorkerMessage, { type: 'complete' }>
		) => Promise<void>
	): Promise<boolean> {
		let worker: Worker;
		try {
			worker = await this.#createWorker();
		} catch {
			throw new Error('The slicing worker could not be started.');
		}
		if (this.#requestId !== requestId) {
			worker.terminate();
			return false;
		}
		this.#worker = worker;

		return new Promise<boolean>((resolve) => {
			let settled = false;
			const finish = (result: boolean) => {
				if (settled) return;
				settled = true;
				this.#pendingResolve = null;
				this.#stopWorker();
				resolve(result);
			};
			this.#pendingResolve = resolve;
			const fail = (message: string) => {
				this.#fail(message);
				finish(false);
			};

			worker.onerror = () => fail('The slicing worker stopped unexpectedly.');
			worker.onmessage = (event: MessageEvent<ExportSliceWorkerMessage>) => {
				const message = event.data;
				if (message.id !== requestId || this.#requestId !== requestId) return;
				void (async () => {
					try {
						if (message.type === 'error') {
							fail(message.message);
							return;
						}
						if (message.type === 'started') {
							this.totalLayers = message.totalLayers;
							return;
						}
						if (message.type === 'layer') {
							await writeLayer(message.layerNumber, message.png);
							this.completedLayers = message.layerNumber;
							this.totalLayers = message.totalLayers;
							this.progress =
								message.totalLayers > 0 ? message.layerNumber / message.totalLayers : 1;
							const next: ExportSliceWorkerRequest = { type: 'continue', id: requestId };
							worker.postMessage(next);
							return;
						}

						await completeProject(message);
						this.completedLayers = message.totalLayers;
						this.totalLayers = message.totalLayers;
						this.progress = 1;
						this.status = 'saved';
						finish(true);
					} catch (error) {
						fail(error instanceof Error ? error.message : 'A project file could not be written.');
					}
				})();
			};

			const positions = input.model.positions.slice();
			const request: ExportSliceWorkerRequest = {
				type: 'start',
				id: requestId,
				positions,
				bounds: input.model.bounds,
				translation: { ...input.translation },
				rotation: { ...input.rotation },
				supportPlan: input.supportPlan,
				raftIslands: input.raftIslands
			};
			worker.postMessage(request, [positions.buffer]);
		});
	}

	#createGcode(
		input: ProjectExportInput,
		message: Extract<ExportSliceWorkerMessage, { type: 'complete' }>
	): string {
		return createTinyMakerGcode({
			modelFileName: input.model.name,
			layerCount: message.totalLayers,
			volumeCubicMm: message.volumeCubicMm
		});
	}

	#fail(message: string) {
		this.status = 'error';
		this.error = message;
	}

	#stopWorker() {
		this.#requestId += 1;
		if (this.#worker) {
			this.#worker.onmessage = null;
			this.#worker.onerror = null;
			this.#worker.terminate();
			this.#worker = null;
		}
		const resolve = this.#pendingResolve;
		this.#pendingResolve = null;
		resolve?.(false);
	}
}
