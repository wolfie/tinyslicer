import { describe, expect, it } from 'vitest';

import { createPostSupportStructure, generateSupportPlan } from '$lib/workspace/supports';
import type { Bounds3 } from '$lib/workspace/stl-importer';
import { ModelLayerMaskRasterizer, type LayerMaskRasterizationProfile } from './model-layer-masks';
import { supportPlanCirclesAtZ } from './support-cross-sections';

type Point = [number, number, number];

const PROFILE: LayerMaskRasterizationProfile = {
	resolution: { x: 128, y: 96 },
	buildAreaMm: { x: 4.08, y: 3.06 },
	layerHeightMm: 0.05
};

function boxPositions(minimum: Point, maximum: Point): Float32Array {
	const [minX, minY, minZ] = minimum;
	const [maxX, maxY, maxZ] = maximum;
	const p000: Point = [minX, minY, minZ];
	const p100: Point = [maxX, minY, minZ];
	const p010: Point = [minX, maxY, minZ];
	const p110: Point = [maxX, maxY, minZ];
	const p001: Point = [minX, minY, maxZ];
	const p101: Point = [maxX, minY, maxZ];
	const p011: Point = [minX, maxY, maxZ];
	const p111: Point = [maxX, maxY, maxZ];
	return Float32Array.from(
		[
			[p000, p010, p110],
			[p000, p110, p100],
			[p001, p101, p111],
			[p001, p111, p011],
			[p000, p100, p101],
			[p000, p101, p001],
			[p010, p011, p111],
			[p010, p111, p110],
			[p000, p001, p011],
			[p000, p011, p010],
			[p100, p110, p111],
			[p100, p111, p101]
		].flat(2) as number[]
	);
}

function boundsFor(positions: Float32Array): Bounds3 {
	const bounds: Bounds3 = {
		min: { x: Infinity, y: Infinity, z: Infinity },
		max: { x: -Infinity, y: -Infinity, z: -Infinity }
	};
	for (let offset = 0; offset < positions.length; offset += 3) {
		bounds.min.x = Math.min(bounds.min.x, positions[offset]);
		bounds.min.y = Math.min(bounds.min.y, positions[offset + 1]);
		bounds.min.z = Math.min(bounds.min.z, positions[offset + 2]);
		bounds.max.x = Math.max(bounds.max.x, positions[offset]);
		bounds.max.y = Math.max(bounds.max.y, positions[offset + 1]);
		bounds.max.z = Math.max(bounds.max.z, positions[offset + 2]);
	}
	return bounds;
}

describe('sliced support contact connectivity', () => {
	it('overlaps the model for several layer planes above an off-grid contact', () => {
		const positions = boxPositions([1.5, 2, 4.03], [2.5, 3, 4.5]);
		const model = { positions, bounds: boundsFor(positions) };
		const point = {
			id: 'support-point-1',
			position: { x: 2.04, y: 2.5, z: 4.03 },
			normal: { x: 0, y: 0, z: -1 }
		};
		expect(createPostSupportStructure(point)).not.toBeNull();
		const plan = generateSupportPlan([point]);
		const modelRasterizer = new ModelLayerMaskRasterizer(model, undefined, undefined, PROFILE);

		const overlappingLayerZs: number[] = [];
		for (let layerIndex = 0; layerIndex < modelRasterizer.layerCount; layerIndex += 1) {
			const zMm = modelRasterizer.layerZMm(layerIndex);
			const circles = supportPlanCirclesAtZ(plan, zMm);
			if (circles.length === 0) continue;
			const modelMask = modelRasterizer.createLayerMask(layerIndex);
			const overlaps = modelMask.data.some((filled, pixelIndex) => {
				if (!filled) return false;
				const column = pixelIndex % modelMask.width;
				const row = Math.floor(pixelIndex / modelMask.width);
				const x = (column + 0.5) * modelRasterizer.pixelPitchMm.x;
				const y = (row + 0.5) * modelRasterizer.pixelPitchMm.y;
				return circles.some(
					(circle) => (x - circle.xMm) ** 2 + (y - circle.yMm) ** 2 <= circle.radiusMm ** 2
				);
			});
			if (overlaps) overlappingLayerZs.push(zMm);
		}

		expect(overlappingLayerZs.map((z) => Number(z.toFixed(2)))).toEqual([4.05, 4.1, 4.15, 4.2]);
	});
});
