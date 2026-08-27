import { describe, expect, it } from 'vitest';

import {
	analyzeUnsupportedLayer,
	dilateBinaryMask,
	type BinaryLayerMask,
	type UnsupportedDetectionSettings
} from './detect-unsupported';

function mask(...rows: string[]): BinaryLayerMask {
	const width = rows[0]?.length ?? 0;
	if (width === 0 || rows.some((row) => row.length !== width)) {
		throw new Error('Test masks must be non-empty rectangles.');
	}
	return {
		width,
		height: rows.length,
		data: Uint8Array.from(rows.join(''), (pixel) => (pixel === '#' ? 1 : 0))
	};
}

function occupiedPixels(layerMask: BinaryLayerMask): [number, number][] {
	const result: [number, number][] = [];
	for (let index = 0; index < layerMask.data.length; index += 1) {
		if (layerMask.data[index] !== 0) {
			result.push([index % layerMask.width, Math.floor(index / layerMask.width)]);
		}
	}
	return result;
}

const SETTINGS: UnsupportedDetectionSettings = {
	pixelPitchMm: 1,
	layerHeightMm: 0.1,
	overhangAngleDegrees: 45,
	minimumOverhangAreaMm2: 1,
	coverageRadiusMm: 2
};

describe('unsupported layer detection', () => {
	it('uses a physical multi-layer allowance without rounding it to an integer first', () => {
		const lower = mask('.....', '..#..', '.....');
		const current = mask('.....', '..##.', '.....');
		const tinyMakerSettings: UnsupportedDetectionSettings = {
			...SETTINGS,
			pixelPitchMm: 0.1275,
			layerHeightMm: 0.05
		};

		const oneLayer = analyzeUnsupportedLayer(current, lower, 1, 1, tinyMakerSettings);
		const threeLayers = analyzeUnsupportedLayer(current, lower, 3, 3, tinyMakerSettings);

		expect(oneLayer.allowanceMm).toBeCloseTo(0.05);
		expect(occupiedPixels(oneLayer.unsupportedMask)).toEqual([[3, 1]]);
		expect(threeLayers.allowanceMm).toBeCloseTo(0.15);
		expect(occupiedPixels(threeLayers.unsupportedMask)).toEqual([]);
	});

	it('classifies a disconnected current-layer component as a mandatory island', () => {
		const empty = mask('.....', '.....', '.....', '.....', '.....');
		const current = mask('.....', '.###.', '.###.', '.###.', '.....');
		const analysis = analyzeUnsupportedLayer(current, empty, 4, 1, {
			...SETTINGS,
			minimumOverhangAreaMm2: 100
		});

		expect(analysis.regions).toHaveLength(1);
		expect(analysis.regions[0]).toMatchObject({
			kind: 'island',
			pixelCount: 9,
			requiresContact: true
		});
		expect(analysis.candidates.length).toBeGreaterThan(0);
		expect(analysis.candidates[0].kind).toBe('island');
	});

	it('classifies excess growth on an inherited component as an overhang', () => {
		const lower = mask('......', '.##...', '......');
		const current = mask('......', '.####.', '......');
		const analysis = analyzeUnsupportedLayer(current, lower, 2, 1, SETTINGS);

		expect(occupiedPixels(analysis.unsupportedMask)).toEqual([
			[3, 1],
			[4, 1]
		]);
		expect(analysis.regions).toHaveLength(1);
		expect(analysis.regions[0].kind).toBe('overhang');
	});

	it('ignores tiny overhang growth while retaining tiny islands', () => {
		const lower = mask('.....', '.##..', '.....');
		const overhang = mask('.....', '.###.', '.....');
		const island = mask('.....', '...#.', '.....');
		const settings = { ...SETTINGS, minimumOverhangAreaMm2: 2 };

		const overhangAnalysis = analyzeUnsupportedLayer(overhang, lower, 2, 1, settings);
		const islandAnalysis = analyzeUnsupportedLayer(island, lower, 2, 1, settings);

		expect(overhangAnalysis.regions[0]).toMatchObject({
			kind: 'overhang',
			requiresContact: false
		});
		expect(overhangAnalysis.candidates).toEqual([]);
		expect(islandAnalysis.regions[0]).toMatchObject({
			kind: 'island',
			requiresContact: true
		});
		expect(islandAnalysis.candidates).toHaveLength(1);
	});

	it('greedily covers a region from deterministic interior pixels', () => {
		const empty = mask(
			'.........',
			'.........',
			'.........',
			'.........',
			'.........',
			'.........',
			'.........',
			'.........',
			'.........'
		);
		const current = mask(
			'#########',
			'#########',
			'#########',
			'#########',
			'#########',
			'#########',
			'#########',
			'#########',
			'#########'
		);

		const first = analyzeUnsupportedLayer(current, empty, 5, 1, SETTINGS);
		const second = analyzeUnsupportedLayer(current, empty, 5, 1, SETTINGS);

		expect(first.candidates[0].pixel).toEqual({ x: 4, y: 4 });
		expect(first.candidates).toEqual(second.candidates);
		expect(first.incompleteRegionIds).toEqual([]);
		for (const [x, y] of occupiedPixels(current)) {
			expect(
				first.candidates.some(
					(candidate) => Math.hypot(candidate.pixel.x - x, candidate.pixel.y - y) <= 2
				)
			).toBe(true);
		}
		expect(first.candidates[0].positionMm.x).toBe(4.5);
		expect(first.candidates[0].positionMm.y).toBe(4.5);
		expect(first.candidates[0].positionMm.z).toBeCloseTo(0.6);
	});

	it('reports regions left incomplete by the candidate safety limit', () => {
		const empty = mask('.......', '.......', '.......');
		const current = mask('#######', '#######', '#######');
		const analysis = analyzeUnsupportedLayer(current, empty, 3, 1, {
			...SETTINGS,
			coverageRadiusMm: 1,
			maximumCandidatesPerRegion: 1
		});

		expect(analysis.candidates).toHaveLength(1);
		expect(analysis.incompleteRegionIds).toEqual([analysis.regions[0].id]);
	});

	it('dilates diagonally only when the Euclidean radius reaches the diagonal', () => {
		const source = mask('...', '.#.', '...');

		expect(occupiedPixels(dilateBinaryMask(source, 1))).toHaveLength(5);
		expect(occupiedPixels(dilateBinaryMask(source, Math.SQRT2))).toHaveLength(9);
	});
});
