import { describe, expect, it, vi } from 'vitest';

import type { BinaryLayerMask } from './detect-unsupported';
import {
	analyzeLayerConnectivity,
	analyzeSupportCoverage,
	analyzeSupportStability,
	analyzeSupportTopology
} from './analyze-support-topology';
import { generateSupportPlan, type ModelSurfaceHit } from '$lib/workspace/supports';

function mask(...rows: string[]): BinaryLayerMask {
	return {
		width: rows[0].length,
		height: rows.length,
		data: Uint8Array.from(rows.join('').replaceAll('.', '0').replaceAll('#', '1'), Number)
	};
}

const SETTINGS = {
	pixelPitchMm: { x: 0.1, y: 0.2 },
	layerHeightMm: 0.05
};

function floatingBoxPositions(): Float32Array {
	const x0 = 14;
	const x1 = 18;
	const y0 = 12;
	const y1 = 16;
	const z0 = 5;
	const z1 = 6;
	const p000 = [x0, y0, z0];
	const p100 = [x1, y0, z0];
	const p010 = [x0, y1, z0];
	const p110 = [x1, y1, z0];
	const p001 = [x0, y0, z1];
	const p101 = [x1, y0, z1];
	const p011 = [x0, y1, z1];
	const p111 = [x1, y1, z1];
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

describe('support topology analysis', () => {
	it('accepts material connected continuously to the first layer', () => {
		const result = analyzeLayerConnectivity(
			[mask('.....', '..#..'), mask('.....', '..#..'), mask('.....', '.###.')],
			SETTINGS
		);

		expect(result.disconnectedRegionCount).toBe(0);
		expect(result.disconnectedLayerCount).toBe(0);
		expect(result.firstDisconnectedZMm).toBeNull();
	});

	it('reports a floating component once even when it persists across layers', () => {
		const result = analyzeLayerConnectivity(
			[mask('.....', '.....'), mask('.##..', '.....'), mask('.##..', '.....')],
			SETTINGS
		);

		expect(result.disconnectedRegionCount).toBe(1);
		expect(result.disconnectedLayerCount).toBe(2);
		expect(result.firstDisconnectedLayerIndex).toBe(1);
		expect(result.firstDisconnectedZMm).toBeCloseTo(0.1);
		expect(result.regions[0]).toMatchObject({
			layerIndex: 1,
			pixelCount: 2,
			centroidMm: { x: 0.2, y: 0.1 }
		});
		expect(result.regions[0].areaMm2).toBeCloseTo(0.04);
	});

	it('keeps the failure after a floating component later joins anchored material', () => {
		const result = analyzeLayerConnectivity(
			[mask('#....'), mask('#..#.'), mask('.###.')],
			SETTINGS
		);

		expect(result.disconnectedRegionCount).toBe(1);
		expect(result.disconnectedLayerCount).toBe(1);
	});

	it('treats a diagonal inter-layer touch as continuous at printer resolution', () => {
		const result = analyzeLayerConnectivity([mask('#..'), mask('.#.')], SETTINGS);

		expect(result.disconnectedRegionCount).toBe(0);
	});

	it('reports progress while retaining only a bounded region sample', () => {
		const onProgress = vi.fn();
		const layers = Array.from({ length: 60 }, (_, index) =>
			index % 2 === 0 ? mask('...') : mask('.#.')
		);
		const result = analyzeLayerConnectivity(layers, { ...SETTINGS, onProgress });

		expect(result.disconnectedRegionCount).toBe(30);
		expect(result.regions).toHaveLength(24);
		expect(onProgress).toHaveBeenLastCalledWith(60, 60);
	});

	it('audits the sliced union of a model and its support geometry', () => {
		const positions = floatingBoxPositions();
		const model = {
			positions,
			bounds: { min: { x: 14, y: 12, z: 5 }, max: { x: 18, y: 16, z: 6 } }
		};
		const transform = {
			translation: { x: 0, y: 0, z: 0 },
			rotation: { x: 0, y: 0, z: 0, w: 1 },
			scale: 1,
			raftIslands: []
		};
		const unsupported = analyzeSupportTopology({
			model,
			...transform,
			supportPlan: { structures: [], unresolvedPoints: [] },
			supportPoints: []
		});
		const contact: ModelSurfaceHit = {
			position: { x: 16, y: 14, z: 5 },
			normal: { x: 0, y: 0, z: -1 }
		};
		const supported = analyzeSupportTopology({
			model,
			...transform,
			supportPlan: generateSupportPlan([{ id: 'support-1', ...contact }]),
			supportPoints: [{ id: 'support-1', ...contact }]
		});

		expect(unsupported.disconnectedRegionCount).toBe(1);
		expect(unsupported.firstDisconnectedZMm).toBeCloseTo(5);
		expect(unsupported.coverage.missingContactCount).toBeGreaterThan(0);
		expect(supported.disconnectedRegionCount).toBe(0);
		expect(supported.coverage.missingContactCount).toBe(0);
	});

	it('reports a missing coverage contact and clears it when a contact is present', () => {
		const layers = [mask('.....', '.....'), mask('.###.', '.###.')];
		const settings = {
			pixelPitchMm: 1,
			layerHeightMm: 0.05,
			layerLookback: 1,
			overhangAngleDegrees: 45,
			minimumOverhangAreaMm2: 0,
			coverageRadiusMm: 3,
			maximumCandidatesPerRegion: 16
		};
		const missing = analyzeSupportCoverage(layers, [], settings);
		const covered = analyzeSupportCoverage(
			layers,
			[
				{
					id: 'support-1',
					position: { ...missing.risks[0].positionMm },
					normal: { x: 0, y: 0, z: -1 }
				}
			],
			settings
		);

		expect(missing).toMatchObject({ missingContactCount: 1, islandRiskCount: 1 });
		expect(covered.missingContactCount).toBe(0);
	});

	it('flags only support shafts above the experimental slenderness ratio', () => {
		const result = analyzeSupportStability([
			{
				id: 'post:short',
				pointIds: ['short'],
				parts: [
					{
						kind: 'shaft',
						start: { x: 0, y: 0, z: 0 },
						end: { x: 0, y: 0, z: 10 },
						startDiameter: 1,
						endDiameter: 1
					}
				]
			},
			{
				id: 'post:tall',
				pointIds: ['tall'],
				parts: [
					{
						kind: 'shaft',
						start: { x: 2, y: 0, z: 0 },
						end: { x: 2, y: 0, z: 25 },
						startDiameter: 1,
						endDiameter: 1
					}
				]
			}
		]);

		expect(result.slenderSupportCount).toBe(1);
		expect(result.risks[0]).toMatchObject({ supportPointId: 'tall', slendernessRatio: 25 });
	});

	it('proposes braces even when an unrelated print region is disconnected', () => {
		const positions = floatingBoxPositions();
		const model = {
			positions,
			bounds: { min: { x: 14, y: 12, z: 5 }, max: { x: 18, y: 16, z: 6 } }
		};
		const tallPost = (id: string, x: number) => ({
			id: `post:${id}`,
			pointIds: [id],
			parts: [
				{
					kind: 'shaft' as const,
					start: { x, y: 2, z: 1 },
					end: { x, y: 2, z: 30 },
					startDiameter: 1.275,
					endDiameter: 1.275
				}
			]
		});
		const result = analyzeSupportTopology({
			model,
			translation: { x: 0, y: 0, z: 0 },
			rotation: { x: 0, y: 0, z: 0, w: 1 },
			scale: 1,
			supportPlan: {
				structures: [tallPost('a', 2), tallPost('b', 7)],
				unresolvedPoints: []
			},
			supportPoints: [],
			raftIslands: []
		});

		expect(result.disconnectedRegionCount).toBeGreaterThan(0);
		expect(result.stability.slenderSupportCount).toBe(2);
		expect(result.bracing.beamCount).toBeGreaterThan(0);
	});
});
