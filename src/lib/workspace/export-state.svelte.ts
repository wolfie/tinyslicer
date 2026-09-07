import { encodeGrayscalePng } from '$lib/slicing/grayscale-png';
import { createTinyMakerGcode, validateProjectName } from '$lib/slicing/tinymaker-project';
import { StoredZipArchive } from '$lib/slicing/zip-archive';
import { TINYMAKER_PROFILE } from '$lib/printer/tinymaker';
import type { ImportedStlModel } from './stl-importer';
import { createNewProjectDirectory, writeNewProjectFile } from './project-files';
import { renderProjectPreviews } from './project-preview';
import type { PreviewMeshData, SliceLayerSource, SliceStreamResult } from './preview-state.svelte';

export type ProjectExportStatus = 'idle' | 'picking' | 'slicing' | 'saved' | 'error';
export type ProjectExportMode = 'directory' | 'archive';

export type ProjectExportInput = {
	model: Pick<ImportedStlModel, 'name'>;
	previewMesh: PreviewMeshData;
	slice: SliceLayerSource;
};

type DirectoryPicker = (options?: {
	id?: string;
	mode?: 'read' | 'readwrite';
}) => Promise<FileSystemDirectoryHandle>;

export type ProjectExportOptions = {
	chooseDirectory?: DirectoryPicker;
	renderPreviews?: typeof renderProjectPreviews;
	downloadFile?: (blob: Blob, filename: string) => void;
};

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

async function createEmptyTinyMakerLayer(): Promise<ArrayBuffer> {
	const { x: width, y: height } = TINYMAKER_PROFILE.resolution;
	const png = await encodeGrayscalePng(width, height, new Uint8Array(width * height));
	return png.buffer as ArrayBuffer;
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
	#renderPreviews: typeof renderProjectPreviews;
	#downloadFile: (blob: Blob, filename: string) => void;
	#abortController: AbortController | null = null;
	#requestId = 0;

	constructor(options: ProjectExportOptions = {}) {
		this.#chooseDirectory = options.chooseDirectory ?? defaultDirectoryPicker;
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
			if (this.#requestId !== requestId) return false;
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
			if (this.#requestId !== requestId) return false;
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
			if (this.#requestId !== requestId) return false;
			this.#fail(
				error instanceof Error ? error.message : 'The print project archive could not be created.'
			);
			return false;
		}
	}

	reset() {
		this.#stopExport();
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
		this.#stopExport();
	}

	async #sliceLayers(
		input: ProjectExportInput,
		requestId: number,
		writeLayer: (layerNumber: number, png: ArrayBuffer) => Promise<void>,
		completeProject: (result: SliceStreamResult) => Promise<void>
	): Promise<boolean> {
		const controller = new AbortController();
		this.#abortController = controller;
		this.totalLayers = input.slice.layerCount;
		try {
			const result = await input.slice.streamPngLayers(async (layerNumber, totalLayers, png) => {
				if (this.#requestId !== requestId) throw new Error('The export was cancelled.');
				this.totalLayers = totalLayers;
				await writeLayer(layerNumber, png);
				this.completedLayers = layerNumber;
				this.progress = totalLayers > 0 ? layerNumber / totalLayers : 1;
			}, controller.signal);
			if (this.#requestId !== requestId) return false;

			// At 0.1 mm the firmware halves the file count, then prints odd-numbered PNGs.
			// An even blank tail keeps the final real odd layer reachable when the stack is odd.
			// Count: https://github.com/TinyMaker3D/TinyMaker-Open-Source-3D-Printer/blob/65fab365ebbd2e3df5ce9552eac79efd6ea75f9a/Firmware/TinyMaker_Firmware_v1_0_2/Interface.ino#L177-L183
			// Selection: https://github.com/TinyMaker3D/TinyMaker-Open-Source-3D-Printer/blob/65fab365ebbd2e3df5ce9552eac79efd6ea75f9a/Firmware/TinyMaker_Firmware_v1_0_2/PNG.ino#L47-L57
			if (result.totalLayers % 2 !== 0) {
				await writeLayer(result.totalLayers + 1, await createEmptyTinyMakerLayer());
			}
			await completeProject(result);
			this.completedLayers = result.totalLayers;
			this.totalLayers = result.totalLayers;
			this.progress = 1;
			this.status = 'saved';
			return true;
		} finally {
			if (this.#abortController === controller) this.#abortController = null;
		}
	}

	#createGcode(input: ProjectExportInput, result: SliceStreamResult): string {
		return createTinyMakerGcode({
			modelFileName: input.model.name,
			layerCount: result.totalLayers,
			volumeCubicMm: result.volumeCubicMm
		});
	}

	#fail(message: string) {
		this.status = 'error';
		this.error = message;
	}

	#stopExport() {
		this.#requestId += 1;
		this.#abortController?.abort();
		this.#abortController = null;
	}
}
