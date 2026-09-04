const encoder = new TextEncoder();
const maximumZip32Value = 0xffffffff;

export type ZipEntryData = string | Blob | ArrayBuffer | ArrayBufferView;

type ZipEntry = {
	name: Uint8Array<ArrayBuffer>;
	data: Uint8Array<ArrayBuffer>;
	crc32: number;
	time: number;
	date: number;
};

const crcTable = (() => {
	const table = new Uint32Array(256);
	for (let index = 0; index < table.length; index += 1) {
		let value = index;
		for (let bit = 0; bit < 8; bit += 1) {
			value = (value & 1) !== 0 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
		}
		table[index] = value >>> 0;
	}
	return table;
})();

function calculateCrc32(data: Uint8Array): number {
	let value = 0xffffffff;
	for (const byte of data) value = crcTable[(value ^ byte) & 0xff] ^ (value >>> 8);
	return (value ^ 0xffffffff) >>> 0;
}

function copyBytes(data: ArrayBuffer | ArrayBufferView): Uint8Array<ArrayBuffer> {
	const source =
		data instanceof ArrayBuffer
			? new Uint8Array(data)
			: new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
	const copy = new Uint8Array(source.byteLength);
	copy.set(source);
	return copy;
}

async function toBytes(data: ZipEntryData): Promise<Uint8Array<ArrayBuffer>> {
	if (typeof data === 'string') return encoder.encode(data);
	if (data instanceof Blob) return new Uint8Array(await data.arrayBuffer());
	return copyBytes(data);
}

function zipDateTime(value: Date): { time: number; date: number } {
	const year = Math.max(1980, Math.min(2107, value.getFullYear()));
	return {
		time: (value.getHours() << 11) | (value.getMinutes() << 5) | Math.floor(value.getSeconds() / 2),
		date: ((year - 1980) << 9) | ((value.getMonth() + 1) << 5) | value.getDate()
	};
}

function header(size: number): { bytes: Uint8Array<ArrayBuffer>; view: DataView } {
	const bytes = new Uint8Array(size);
	return { bytes, view: new DataView(bytes.buffer) };
}

function validateEntryName(name: string) {
	const segments = name.split('/');
	if (
		!name ||
		name.startsWith('/') ||
		name.includes('\\') ||
		name.includes('\0') ||
		segments.some((segment) => !segment || segment === '.' || segment === '..')
	) {
		throw new Error(`Invalid ZIP entry name: ${name}`);
	}
}

/** A minimal ZIP32 writer using uncompressed entries. PNG data is already compressed. */
export class StoredZipArchive {
	#entries: ZipEntry[] = [];
	#names = new Set<string>();

	async add(name: string, data: ZipEntryData, modified = new Date()): Promise<void> {
		validateEntryName(name);
		if (this.#names.has(name)) throw new Error(`Duplicate ZIP entry: ${name}`);

		const nameBytes = encoder.encode(name);
		if (nameBytes.byteLength > 0xffff) throw new Error('A ZIP entry name is too long.');
		const bytes = await toBytes(data);
		if (bytes.byteLength > maximumZip32Value)
			throw new Error('A project file is too large for ZIP.');
		const { time, date } = zipDateTime(modified);
		this.#entries.push({ name: nameBytes, data: bytes, crc32: calculateCrc32(bytes), time, date });
		this.#names.add(name);
	}

	toBlob(): Blob {
		if (this.#entries.length > 0xffff) throw new Error('The project has too many files for ZIP.');

		const parts: BlobPart[] = [];
		const centralParts: BlobPart[] = [];
		let localOffset = 0;

		for (const entry of this.#entries) {
			if (localOffset > maximumZip32Value) throw new Error('The project is too large for ZIP.');
			const local = header(30);
			local.view.setUint32(0, 0x04034b50, true);
			local.view.setUint16(4, 20, true);
			local.view.setUint16(6, 0x0800, true);
			local.view.setUint16(8, 0, true);
			local.view.setUint16(10, entry.time, true);
			local.view.setUint16(12, entry.date, true);
			local.view.setUint32(14, entry.crc32, true);
			local.view.setUint32(18, entry.data.byteLength, true);
			local.view.setUint32(22, entry.data.byteLength, true);
			local.view.setUint16(26, entry.name.byteLength, true);
			parts.push(local.bytes, entry.name, entry.data);

			const central = header(46);
			central.view.setUint32(0, 0x02014b50, true);
			central.view.setUint16(4, 20, true);
			central.view.setUint16(6, 20, true);
			central.view.setUint16(8, 0x0800, true);
			central.view.setUint16(10, 0, true);
			central.view.setUint16(12, entry.time, true);
			central.view.setUint16(14, entry.date, true);
			central.view.setUint32(16, entry.crc32, true);
			central.view.setUint32(20, entry.data.byteLength, true);
			central.view.setUint32(24, entry.data.byteLength, true);
			central.view.setUint16(28, entry.name.byteLength, true);
			central.view.setUint32(42, localOffset, true);
			centralParts.push(central.bytes, entry.name);

			localOffset += 30 + entry.name.byteLength + entry.data.byteLength;
		}

		const centralOffset = localOffset;
		const centralSize = centralParts.reduce((size, part) => {
			if (typeof part === 'string') return size + encoder.encode(part).byteLength;
			if (part instanceof Blob) return size + part.size;
			return size + part.byteLength;
		}, 0);
		if (centralOffset + centralSize > maximumZip32Value) {
			throw new Error('The project is too large for ZIP.');
		}

		const end = header(22);
		end.view.setUint32(0, 0x06054b50, true);
		end.view.setUint16(8, this.#entries.length, true);
		end.view.setUint16(10, this.#entries.length, true);
		end.view.setUint32(12, centralSize, true);
		end.view.setUint32(16, centralOffset, true);

		return new Blob([...parts, ...centralParts, end.bytes], { type: 'application/zip' });
	}
}
