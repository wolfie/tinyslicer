import { describe, expect, it, vi } from 'vitest';

import { createNewProjectDirectory, writeNewProjectFile } from './project-files';

const missing = () => new DOMException('Missing', 'NotFoundError');

describe('project file safety', () => {
	it('refuses an existing project directory without calling create', async () => {
		const existing = {} as FileSystemDirectoryHandle;
		const parent = {
			getDirectoryHandle: vi.fn().mockResolvedValue(existing),
			getFileHandle: vi.fn()
		} as unknown as FileSystemDirectoryHandle;

		await expect(createNewProjectDirectory(parent, 'Already here')).rejects.toThrow(
			/already exists/
		);
		expect(parent.getDirectoryHandle).toHaveBeenCalledTimes(1);
		expect(parent.getDirectoryHandle).not.toHaveBeenCalledWith('Already here', { create: true });
	});

	it('creates a missing project directory and only writes a missing file', async () => {
		const written: FileSystemWriteChunkType[] = [];
		const file = {
			createWritable: vi.fn().mockResolvedValue({
				write: vi.fn(async (value) => written.push(value)),
				close: vi.fn(),
				abort: vi.fn()
			})
		} as unknown as FileSystemFileHandle;
		const directory = {
			values: async function* () {},
			getFileHandle: vi.fn().mockRejectedValueOnce(missing()).mockResolvedValueOnce(file)
		} as unknown as FileSystemDirectoryHandle;
		const parent = {
			getDirectoryHandle: vi.fn().mockRejectedValueOnce(missing()).mockResolvedValueOnce(directory),
			getFileHandle: vi.fn().mockRejectedValue(missing())
		} as unknown as FileSystemDirectoryHandle;

		await expect(createNewProjectDirectory(parent, 'New project')).resolves.toBe(directory);
		await writeNewProjectFile(directory, '1.png', 'pixels');

		expect(parent.getDirectoryHandle).toHaveBeenLastCalledWith('New project', { create: true });
		expect(directory.getFileHandle).toHaveBeenNthCalledWith(1, '1.png');
		expect(directory.getFileHandle).toHaveBeenNthCalledWith(2, '1.png', { create: true });
		expect(written).toEqual(['pixels']);
	});

	it('refuses to open a writable stream for an existing file', async () => {
		const file = { createWritable: vi.fn() } as unknown as FileSystemFileHandle;
		const directory = {
			getFileHandle: vi.fn().mockResolvedValue(file)
		} as unknown as FileSystemDirectoryHandle;

		await expect(writeNewProjectFile(directory, 'run.gcode', 'data')).rejects.toThrow(
			/already exists/
		);
		expect(file.createWritable).not.toHaveBeenCalled();
	});
});
