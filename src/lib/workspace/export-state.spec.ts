import { describe, expect, it } from 'vitest';

import type {
	ExportSliceWorkerMessage,
	ExportSliceWorkerRequest
} from '$lib/slicing/export-slice-worker-types';
import type { ImportedStlModel } from './stl-importer';
import { ProjectExport, type ProjectExportInput } from './export-state.svelte';

const missing = () => new DOMException('Missing', 'NotFoundError');

class MemoryFileHandle {
	name: string;
	kind = 'file' as const;
	data: FileSystemWriteChunkType | undefined;

	constructor(name: string) {
		this.name = name;
	}

	async createWritable() {
		let pending: FileSystemWriteChunkType;
		return {
			write: async (data: FileSystemWriteChunkType) => {
				pending = data;
			},
			close: async () => {
				this.data = pending;
			},
			abort: async () => {}
		};
	}
}

class MemoryDirectoryHandle {
	name: string;
	kind = 'directory' as const;
	files = new Map<string, MemoryFileHandle>();
	directories = new Map<string, MemoryDirectoryHandle>();

	constructor(name: string) {
		this.name = name;
	}

	async getDirectoryHandle(name: string, options?: { create?: boolean }) {
		const existing = this.directories.get(name);
		if (existing) return existing;
		if (!options?.create) throw missing();
		const directory = new MemoryDirectoryHandle(name);
		this.directories.set(name, directory);
		return directory;
	}

	async getFileHandle(name: string, options?: { create?: boolean }) {
		const existing = this.files.get(name);
		if (existing) return existing;
		if (!options?.create) throw missing();
		const file = new MemoryFileHandle(name);
		this.files.set(name, file);
		return file;
	}

	async *values() {
		yield* this.directories.values();
		yield* this.files.values();
	}
}

class StubSliceWorker {
	onmessage: ((event: MessageEvent<ExportSliceWorkerMessage>) => void) | null = null;
	onerror: ((event: ErrorEvent) => void) | null = null;
	#id = 0;

	postMessage(request: ExportSliceWorkerRequest) {
		if (request.type === 'start') {
			this.#id = request.id;
			queueMicrotask(() => {
				this.onmessage?.({
					data: { type: 'started', id: this.#id, totalLayers: 1 }
				} as MessageEvent<ExportSliceWorkerMessage>);
				this.onmessage?.({
					data: {
						type: 'layer',
						id: this.#id,
						layerNumber: 1,
						totalLayers: 1,
						png: Uint8Array.from([137, 80, 78, 71]).buffer
					}
				} as MessageEvent<ExportSliceWorkerMessage>);
			});
		} else if (request.type === 'continue') {
			queueMicrotask(() =>
				this.onmessage?.({
					data: { type: 'complete', id: this.#id, totalLayers: 1, volumeCubicMm: 10 }
				} as MessageEvent<ExportSliceWorkerMessage>)
			);
		}
	}

	terminate() {}
}

function model(): ImportedStlModel {
	return {
		name: 'tooth.stl',
		format: 'Binary',
		positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 1]),
		normals: new Float32Array(9),
		bounds: { min: { x: 0, y: 0, z: 0 }, max: { x: 1, y: 1, z: 1 } },
		dimensions: { x: 1, y: 1, z: 1 },
		triangleCount: 1,
		byteLength: 134
	};
}

function exportInput(): ProjectExportInput {
	return {
		model: model(),
		translation: { x: 0, y: 0, z: 0 },
		rotation: { x: 0, y: 0, z: 0, w: 1 },
		supportPlan: { structures: [], unresolvedPoints: [] },
		raftIslands: [],
		previewMesh: { positions: new Float32Array(9), normals: new Float32Array(9) }
	};
}

async function zipEntryNames(blob: Blob): Promise<string[]> {
	const bytes = new Uint8Array(await blob.arrayBuffer());
	const view = new DataView(bytes.buffer);
	const names: string[] = [];
	let offset = 0;
	while (view.getUint32(offset, true) === 0x04034b50) {
		const size = view.getUint32(offset + 18, true);
		const nameLength = view.getUint16(offset + 26, true);
		const extraLength = view.getUint16(offset + 28, true);
		const nameStart = offset + 30;
		names.push(new TextDecoder().decode(bytes.subarray(nameStart, nameStart + nameLength)));
		offset = nameStart + nameLength + extraLength + size;
	}
	return names;
}

describe('ProjectExport', () => {
	it('creates one new folder and streams every expected project file into it', async () => {
		const parent = new MemoryDirectoryHandle('Prints');
		const projectExport = new ProjectExport({
			chooseDirectory: async () => parent as unknown as FileSystemDirectoryHandle,
			createWorker: async () => new StubSliceWorker() as unknown as Worker,
			renderPreviews: async () => ({
				preview: new Blob(['large preview']),
				cropped: new Blob(['small preview'])
			})
		});

		await expect(projectExport.start(exportInput(), 'Tooth')).resolves.toBe(true);

		const project = parent.directories.get('Tooth');
		expect(projectExport.status).toBe('saved');
		expect(projectExport.savedPath).toBe('Prints/Tooth');
		expect([...project!.files.keys()]).toEqual([
			'preview.png',
			'preview_cropping.png',
			'1.png',
			'run.gcode'
		]);
		expect(project!.files.get('run.gcode')?.data).toContain(';totalLayer:1');
	});

	it('downloads a ZIP containing the complete project folder', async () => {
		let downloaded: { blob: Blob; filename: string } | undefined;
		const projectExport = new ProjectExport({
			createWorker: async () => new StubSliceWorker() as unknown as Worker,
			renderPreviews: async () => ({
				preview: new Blob(['large preview']),
				cropped: new Blob(['small preview'])
			}),
			downloadFile: (blob, filename) => {
				downloaded = { blob, filename };
			}
		});

		await expect(projectExport.downloadArchive(exportInput(), 'Tooth')).resolves.toBe(true);

		expect(projectExport.status).toBe('saved');
		expect(projectExport.mode).toBe('archive');
		expect(projectExport.downloadedFilename).toBe('Tooth.zip');
		expect(downloaded?.filename).toBe('Tooth.zip');
		expect(await zipEntryNames(downloaded!.blob)).toEqual([
			'Tooth/preview.png',
			'Tooth/preview_cropping.png',
			'Tooth/1.png',
			'Tooth/run.gcode'
		]);
	});

	it('does not open the picker when the project name is unsafe', async () => {
		let pickerCalls = 0;
		const projectExport = new ProjectExport({
			chooseDirectory: async () => {
				pickerCalls += 1;
				return new MemoryDirectoryHandle('Prints') as unknown as FileSystemDirectoryHandle;
			}
		});

		await expect(projectExport.start(exportInput(), '../unsafe')).resolves.toBe(false);
		expect(pickerCalls).toBe(0);
		expect(projectExport.status).toBe('error');
	});
});
