function isNotFound(error: unknown): boolean {
	return error instanceof DOMException && error.name === 'NotFoundError';
}

function isTypeMismatch(error: unknown): boolean {
	return error instanceof DOMException && error.name === 'TypeMismatchError';
}

/**
 * Creates a child only after proving that no file or directory currently owns
 * the name. The File System Access API has no exclusive-create primitive, so
 * every individual file is checked again immediately before it is created.
 */
export async function createNewProjectDirectory(
	parent: FileSystemDirectoryHandle,
	name: string
): Promise<FileSystemDirectoryHandle> {
	try {
		await parent.getDirectoryHandle(name);
		throw new Error(`A folder named “${name}” already exists. Choose a new project name.`);
	} catch (error) {
		if (isTypeMismatch(error)) {
			throw new Error(`A file named “${name}” already exists. Choose a new project name.`, {
				cause: error
			});
		}
		if (!isNotFound(error)) throw error;
	}
	try {
		await parent.getFileHandle(name);
		throw new Error(`A file named “${name}” already exists. Choose a new project name.`);
	} catch (error) {
		if (!isNotFound(error)) throw error;
	}
	const directory = await parent.getDirectoryHandle(name, { create: true });
	const iterable = directory as FileSystemDirectoryHandle & {
		values(): AsyncIterableIterator<FileSystemHandle>;
	};
	for await (const entry of iterable.values()) {
		throw new Error(
			`TinySlicer stopped because the project folder unexpectedly contains “${entry.name}”.`
		);
	}
	return directory;
}

export async function writeNewProjectFile(
	directory: FileSystemDirectoryHandle,
	name: string,
	data: FileSystemWriteChunkType
): Promise<void> {
	try {
		await directory.getFileHandle(name);
		throw new Error(
			`TinySlicer stopped because “${name}” already exists in the new project folder.`
		);
	} catch (error) {
		if (!isNotFound(error)) throw error;
	}

	const handle = await directory.getFileHandle(name, { create: true });
	const writable = await handle.createWritable();
	try {
		await writable.write(data);
		await writable.close();
	} catch (error) {
		try {
			await writable.abort();
		} catch {
			// Preserve the original write error. A partially created file remains
			// inside this newly created project directory and is never reused.
		}
		throw error;
	}
}
