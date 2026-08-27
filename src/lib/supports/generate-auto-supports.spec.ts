import { describe, expect, it } from 'vitest';

import type { LayerMaskRasterizationProfile } from '$lib/slicing/model-layer-masks';
import {
	IDENTITY_MODEL_ROTATION,
	ZERO_MODEL_TRANSLATION
} from '$lib/workspace/build-volume-renderer/model-transform';
import type { Bounds3 } from '$lib/workspace/stl-importer';
import { generateAutoSupportHits, type AutoSupportSettings } from './generate-auto-supports';

const PROFILE: LayerMaskRasterizationProfile = {
	resolution: { x: 16, y: 16 },
	buildAreaMm: { x: 16, y: 16 },
	layerHeightMm: 1
};

const SETTINGS: AutoSupportSettings = {
	layerLookback: 2,
	overhangAngleDegrees: 45,
	minimumOverhangAreaMm2: 0,
	coverageRadiusMm: 3,
	maximumCandidatesPerRegion: 32,
	maximumSupportPoints: 32
};

type Point = [number, number, number];

function boxPositions(minimum: Point, maximum: Point): number[] {
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
	return [
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
	].flat(2) as number[];
}

function modelFromPositions(positionValues: readonly number[]) {
	const positions = Float32Array.from(positionValues);
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
	return { positions, bounds };
}

function generate(positionValues: readonly number[], settings = SETTINGS) {
	return generateAutoSupportHits(
		modelFromPositions(positionValues),
		ZERO_MODEL_TRANSLATION,
		IDENTITY_MODEL_ROTATION,
		settings,
		PROFILE
	);
}

describe('automatic support suggestions', () => {
	it('covers a floating horizontal island with valid downward contacts', () => {
		const first = generate(boxPositions([4, 4, 5], [12, 12, 6]));
		const second = generate(boxPositions([4, 4, 5], [12, 12, 6]));

		expect(first.hits.length).toBeGreaterThan(0);
		expect(first.hits).toEqual(second.hits);
		expect(first.hits.every((hit) => hit.position.z === 5)).toBe(true);
		expect(first.hits.every((hit) => hit.normal.z === -1)).toBe(true);
		expect(
			new Set(first.hits.map((hit) => `${hit.position.x}:${hit.position.y}:${hit.position.z}`)).size
		).toBe(first.hits.length);
		expect(first.diagnostics.meshIsWatertightAtPixelSamples).toBe(true);
		expect(first.diagnostics.truncated).toBe(false);
	});

	it('does not support an unchanged vertical solid resting on the plate', () => {
		const result = generate(boxPositions([4, 4, 0], [12, 12, 6]));

		expect(result.hits).toEqual([]);
		expect(result.diagnostics.meshIsWatertightAtPixelSamples).toBe(true);
	});

	it('finds horizontal growth beyond a narrower plate-connected stem', () => {
		const result = generate([
			...boxPositions([7, 7, 0], [9, 9, 5]),
			...boxPositions([4, 4, 5], [12, 12, 6])
		]);

		expect(result.hits.length).toBeGreaterThan(0);
		expect(result.hits.some((hit) => hit.position.x < 7 || hit.position.x > 9)).toBe(true);
	});

	it('terminates a post on model geometry below when enough clearance exists', () => {
		const result = generate([
			...boxPositions([4, 4, 0], [12, 12, 3]),
			...boxPositions([4, 4, 8], [12, 12, 9])
		]);

		expect(result.hits.length).toBeGreaterThan(0);
		expect(result.hits.every((hit) => hit.lowerContactPosition?.z === 3)).toBe(true);
	});

	it('stops at the configured global support limit', () => {
		const result = generate(boxPositions([4, 4, 5], [12, 12, 6]), {
			...SETTINGS,
			coverageRadiusMm: 1,
			maximumSupportPoints: 2
		});

		expect(result.hits).toHaveLength(2);
		expect(result.diagnostics.truncated).toBe(true);
	});

	it('refuses to guess contacts for an open mesh', () => {
		const result = generate([4, 4, 5, 12, 4, 5, 4, 12, 5]);

		expect(result.hits).toEqual([]);
		expect(result.diagnostics.meshIsWatertightAtPixelSamples).toBe(false);
		expect(result.diagnostics.oddIntersectionPixelCount).toBeGreaterThan(0);
	});
});
