import { describe, expect, it } from 'vitest';

import { StoredZipArchive } from './zip-archive';

const decoder = new TextDecoder();

async function readStoredEntries(blob: Blob): Promise<Map<string, Uint8Array>> {
	const bytes = new Uint8Array(await blob.arrayBuffer());
	const view = new DataView(bytes.buffer);
	const entries = new Map<string, Uint8Array>();
	let offset = 0;

	while (view.getUint32(offset, true) === 0x04034b50) {
		expect(view.getUint16(offset + 6, true) & 0x0800).toBe(0x0800);
		expect(view.getUint16(offset + 8, true)).toBe(0);
		const size = view.getUint32(offset + 18, true);
		const nameLength = view.getUint16(offset + 26, true);
		const extraLength = view.getUint16(offset + 28, true);
		const nameStart = offset + 30;
		const dataStart = nameStart + nameLength + extraLength;
		entries.set(
			decoder.decode(bytes.subarray(nameStart, nameStart + nameLength)),
			bytes.slice(dataStart, dataStart + size)
		);
		offset = dataStart + size;
	}

	expect(view.getUint32(offset, true)).toBe(0x02014b50);
	const endOffset = bytes.byteLength - 22;
	expect(view.getUint32(endOffset, true)).toBe(0x06054b50);
	expect(view.getUint16(endOffset + 10, true)).toBe(entries.size);
	expect(view.getUint32(endOffset + 16, true)).toBe(offset);
	return entries;
}

describe('StoredZipArchive', () => {
	it('creates a standard stored ZIP with UTF-8 paths and intact file contents', async () => {
		const archive = new StoredZipArchive();
		await archive.add('Molar №1/1.png', Uint8Array.from([137, 80, 78, 71]));
		await archive.add('Molar №1/run.gcode', 'G28\nM18\n');

		const blob = archive.toBlob();
		const entries = await readStoredEntries(blob);

		expect(blob.type).toBe('application/zip');
		expect([...entries.keys()]).toEqual(['Molar №1/1.png', 'Molar №1/run.gcode']);
		expect([...entries.get('Molar №1/1.png')!]).toEqual([137, 80, 78, 71]);
		expect(decoder.decode(entries.get('Molar №1/run.gcode'))).toBe('G28\nM18\n');
	});

	it('rejects duplicate or unsafe entry paths', async () => {
		const archive = new StoredZipArchive();
		await archive.add('Project/1.png', new Uint8Array());
		await expect(archive.add('Project/1.png', new Uint8Array())).rejects.toThrow('Duplicate');
		await expect(archive.add('../outside', new Uint8Array())).rejects.toThrow('Invalid');
	});
});
