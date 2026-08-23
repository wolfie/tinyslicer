import { describe, expect, it } from 'vitest';

import { TINYMAKER_PROFILE } from '$lib/printer/tinymaker';
import { importStlBuffer } from './stl-importer';

const ASCII_TRIANGLE = `solid triangle
facet normal 0 0 1
  outer loop
    vertex 0 0 5
    vertex 2 0 5
    vertex 0 2 5
  endloop
endfacet
endsolid triangle`;

function asciiBuffer(source: string): ArrayBuffer {
	return new TextEncoder().encode(source).buffer as ArrayBuffer;
}

function binaryTriangle(): ArrayBuffer {
	const buffer = new ArrayBuffer(134);
	const view = new DataView(buffer);
	view.setUint32(80, 1, true);

	const values = [0, 0, 1, 0, 0, 2, 2, 0, 2, 0, 2, 2];
	values.forEach((value, index) => view.setFloat32(84 + index * 4, value, true));
	return buffer;
}

describe('STL importing', () => {
	it('parses ASCII geometry and centers its bottom on the build plate', () => {
		const model = importStlBuffer(asciiBuffer(ASCII_TRIANGLE), 'triangle.stl');

		expect(model.format).toBe('ASCII');
		expect(model.triangleCount).toBe(1);
		expect(model.dimensions).toEqual({ x: 2, y: 2, z: 0 });
		expect(model.bounds.min.z).toBe(0);
		expect((model.bounds.min.x + model.bounds.max.x) / 2).toBeCloseTo(
			TINYMAKER_PROFILE.buildVolume.x / 2
		);
		expect((model.bounds.min.y + model.bounds.max.y) / 2).toBeCloseTo(
			TINYMAKER_PROFILE.buildVolume.y / 2
		);
	});

	it('parses binary geometry and preserves its dimensions', () => {
		const model = importStlBuffer(binaryTriangle(), 'binary.stl');

		expect(model.format).toBe('Binary');
		expect(model.triangleCount).toBe(1);
		expect(model.dimensions).toEqual({ x: 2, y: 2, z: 0 });
		expect(model.bounds.min.z).toBe(0);
	});

	it('rejects files without triangles', () => {
		expect(() => importStlBuffer(asciiBuffer('solid empty\nendsolid empty'), 'empty.stl')).toThrow(
			'could not be parsed'
		);
	});
});
