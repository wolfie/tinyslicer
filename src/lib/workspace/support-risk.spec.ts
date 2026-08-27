import { describe, expect, it } from 'vitest';

import { IDENTITY_MODEL_ROTATION } from './build-volume-renderer/model-transform';
import type { ImportedStlModel } from './stl-importer';
import { detectSupportRiskTriangles } from './support-risk';

function triangleModel(positions: number[], normal: [number, number, number]): ImportedStlModel {
	const normals = new Float32Array([...normal, ...normal, ...normal]);
	const xs = positions.filter((_, index) => index % 3 === 0);
	const ys = positions.filter((_, index) => index % 3 === 1);
	const zs = positions.filter((_, index) => index % 3 === 2);
	return {
		name: 'triangle.stl',
		format: 'Binary',
		positions: new Float32Array(positions),
		normals,
		bounds: {
			min: { x: Math.min(...xs), y: Math.min(...ys), z: Math.min(...zs) },
			max: { x: Math.max(...xs), y: Math.max(...ys), z: Math.max(...zs) }
		},
		dimensions: {
			x: Math.max(...xs) - Math.min(...xs),
			y: Math.max(...ys) - Math.min(...ys),
			z: Math.max(...zs) - Math.min(...zs)
		},
		triangleCount: 1,
		byteLength: 134
	};
}

describe('support-risk triangle preview', () => {
	it('marks a downward-facing facet suspended above the plate', () => {
		const model = triangleModel([0, 0, 4, 0, 1, 4, 1, 0, 4], [0, 0, -1]);

		expect(
			detectSupportRiskTriangles(model, { x: 0, y: 0, z: 0 }, IDENTITY_MODEL_ROTATION).triangleCount
		).toBe(1);
	});

	it('does not mark a downward-facing facet resting on the build plate', () => {
		const model = triangleModel([0, 0, 0, 0, 1, 0, 1, 0, 0], [0, 0, -1]);

		expect(
			detectSupportRiskTriangles(model, { x: 0, y: 0, z: 0 }, IDENTITY_MODEL_ROTATION).triangleCount
		).toBe(0);
	});

	it('does not mark upward-facing or steep facets', () => {
		const upward = triangleModel([0, 0, 4, 1, 0, 4, 0, 1, 4], [0, 0, 1]);
		const steep = triangleModel([0, 0, 4, 0, 0, 5, 0, 1, 4], [-1, 0, 0]);

		expect(
			detectSupportRiskTriangles(upward, { x: 0, y: 0, z: 0 }, IDENTITY_MODEL_ROTATION)
				.triangleCount
		).toBe(0);
		expect(
			detectSupportRiskTriangles(steep, { x: 0, y: 0, z: 0 }, IDENTITY_MODEL_ROTATION).triangleCount
		).toBe(0);
	});

	it('uses the composed model rotation when classifying facets', () => {
		const model = triangleModel([0, 0, 4, 0, 0, 5, 0, 1, 4], [-1, 0, 0]);
		const quarterTurnAroundY = { x: 0, y: -Math.SQRT1_2, z: 0, w: Math.SQRT1_2 };

		expect(
			detectSupportRiskTriangles(model, { x: 0, y: 0, z: 4 }, quarterTurnAroundY).triangleCount
		).toBe(1);
	});
});
