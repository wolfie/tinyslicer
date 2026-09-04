const PNG_SIGNATURE = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);
const textEncoder = new TextEncoder();

function writeUint32(target: Uint8Array, offset: number, value: number) {
	new DataView(target.buffer, target.byteOffset, target.byteLength).setUint32(offset, value);
}

function crc32(type: Uint8Array, data: Uint8Array): number {
	let crc = 0xffffffff;
	for (const bytes of [type, data]) {
		for (const byte of bytes) {
			crc ^= byte;
			for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
		}
	}
	return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(typeName: string, data: Uint8Array): Uint8Array {
	const type = textEncoder.encode(typeName);
	const chunk = new Uint8Array(12 + data.byteLength);
	writeUint32(chunk, 0, data.byteLength);
	chunk.set(type, 4);
	chunk.set(data, 8);
	writeUint32(chunk, 8 + data.byteLength, crc32(type, data));
	return chunk;
}

function join(parts: readonly Uint8Array[]): Uint8Array {
	const output = new Uint8Array(parts.reduce((length, part) => length + part.byteLength, 0));
	let offset = 0;
	for (const part of parts) {
		output.set(part, offset);
		offset += part.byteLength;
	}
	return output;
}

async function deflate(data: Uint8Array): Promise<Uint8Array> {
	if (typeof CompressionStream === 'undefined') {
		throw new Error('This browser cannot compress the layer images.');
	}
	const owned = new Uint8Array(data.byteLength);
	owned.set(data);
	const stream = new Blob([owned.buffer]).stream().pipeThrough(new CompressionStream('deflate'));
	return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Encodes one printer layer as a standards-compliant 8-bit grayscale PNG. */
export async function encodeGrayscalePng(
	width: number,
	height: number,
	pixels: Uint8Array
): Promise<Uint8Array> {
	if (!Number.isInteger(width) || width <= 0 || !Number.isInteger(height) || height <= 0) {
		throw new Error('PNG dimensions must be positive integers.');
	}
	if (pixels.byteLength !== width * height) {
		throw new Error(`Expected ${width * height} grayscale pixels, received ${pixels.byteLength}.`);
	}

	// PNG filter 0 precedes each scanline. Coverage images contain long zero runs,
	// so the browser's DEFLATE implementation still compresses them very well.
	const scanlines = new Uint8Array((width + 1) * height);
	for (let row = 0; row < height; row += 1) {
		scanlines.set(pixels.subarray(row * width, (row + 1) * width), row * (width + 1) + 1);
	}

	const ihdr = new Uint8Array(13);
	writeUint32(ihdr, 0, width);
	writeUint32(ihdr, 4, height);
	ihdr[8] = 8; // bit depth
	ihdr[9] = 0; // grayscale
	return join([
		PNG_SIGNATURE,
		pngChunk('IHDR', ihdr),
		pngChunk('IDAT', await deflate(scanlines)),
		pngChunk('IEND', new Uint8Array())
	]);
}
