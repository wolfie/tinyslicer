import { inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';

import { encodeGrayscalePng } from './grayscale-png';

function chunks(png: Uint8Array): Map<string, Uint8Array> {
	const result = new Map<string, Uint8Array>();
	const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
	for (let offset = 8; offset < png.byteLength;) {
		const length = view.getUint32(offset);
		const type = new TextDecoder().decode(png.subarray(offset + 4, offset + 8));
		result.set(type, png.slice(offset + 8, offset + 8 + length));
		offset += 12 + length;
	}
	return result;
}

describe('encodeGrayscalePng', () => {
	it('writes an 8-bit grayscale PNG with the source pixels in row order', async () => {
		const png = await encodeGrayscalePng(2, 2, Uint8Array.from([0, 63, 127, 255]));
		expect([...png.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);

		const parsed = chunks(png);
		const ihdr = parsed.get('IHDR');
		expect(ihdr).toBeDefined();
		expect(ihdr?.[8]).toBe(8);
		expect(ihdr?.[9]).toBe(0);
		expect([...inflateSync(parsed.get('IDAT')!)]).toEqual([0, 0, 63, 0, 127, 255]);
	});

	it('rejects pixel buffers that do not match the dimensions', async () => {
		await expect(encodeGrayscalePng(2, 2, new Uint8Array(3))).rejects.toThrow(/Expected 4/);
	});
});
