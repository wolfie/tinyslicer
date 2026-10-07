import { LayerCoverageRasterizer } from '$lib/slicing/layer-coverage';
import { DEFAULT_AUTO_SUPPORT_SETTINGS } from './generate-auto-supports';
import {
	analyzeUnsupportedLayer,
	type BinaryLayerMask,
	type CoverageContactCandidate,
	type UnsupportedRegionKind
} from './detect-unsupported';
import type { RaftIsland } from './raft-plan';
import { generateSupportBracingPlan, type SupportBracingPlan } from './support-bracing-plan';
import type {
	ModelRotation,
	ModelScale,
	ModelTranslation
} from '$lib/workspace/build-volume-renderer/types';
import type { ImportedStlModel, Point3 } from '$lib/workspace/stl-importer';
import type { SupportPlan, SupportPoint, SupportStructure } from '$lib/workspace/supports';

export const SUPPORT_TOPOLOGY_PROGRESS_LAYER_STRIDE = 16;
export const MAX_REPORTED_DISCONNECTED_REGIONS = 24;
export const MAX_REPORTED_COVERAGE_RISKS = 24;
/** Experimental prompt for braces, not a calibrated failure threshold. */
export const SUPPORT_SHAFT_SLENDERNESS_WARNING_RATIO = 20;

export type DisconnectedPrintRegion = {
	layerIndex: number;
	zMm: number;
	pixelCount: number;
	areaMm2: number;
	centroidMm: { x: number; y: number };
};

export type SupportTopologyAnalysis = {
	meshIsWatertightAtPixelSamples: boolean;
	analyzedLayerCount: number;
	disconnectedRegionCount: number;
	disconnectedLayerCount: number;
	firstDisconnectedLayerIndex: number | null;
	firstDisconnectedZMm: number | null;
	regions: readonly DisconnectedPrintRegion[];
	coverage: SupportCoverageAnalysis;
	stability: SupportStabilityAnalysis;
	bracing: SupportBracingPlan;
};

export type SupportCoverageRisk = {
	layerIndex: number;
	zMm: number;
	kind: UnsupportedRegionKind;
	positionMm: { x: number; y: number; z: number };
	coveredAreaMm2: number;
};

export type SupportCoverageAnalysis = {
	missingContactCount: number;
	islandRiskCount: number;
	overhangRiskCount: number;
	coverageRadiusMm: number;
	risks: readonly SupportCoverageRisk[];
};

export type SlenderSupportRisk = {
	supportPointId: string;
	shaftLengthMm: number;
	shaftDiameterMm: number;
	slendernessRatio: number;
};

export type SupportStabilityAnalysis = {
	slenderSupportCount: number;
	maximumSlendernessRatio: number;
	risks: readonly SlenderSupportRisk[];
};

export type SupportTopologyInput = {
	model: Pick<ImportedStlModel, 'positions' | 'bounds'>;
	translation: ModelTranslation;
	rotation: ModelRotation;
	scale: ModelScale;
	supportPlan: SupportPlan;
	supportPoints: readonly SupportPoint[];
	raftIslands: readonly RaftIsland[];
};

export type SupportTopologyProgress = (completedLayers: number, totalLayers: number) => void;

type ConnectivitySettings = {
	pixelPitchMm: { x: number; y: number };
	layerHeightMm: number;
	meshIsWatertightAtPixelSamples?: boolean;
	onProgress?: SupportTopologyProgress;
};

export type CoverageSettings = {
	pixelPitchMm: number;
	layerHeightMm: number;
	layerLookback: number;
	overhangAngleDegrees: number;
	minimumOverhangAreaMm2: number;
	coverageRadiusMm: number;
	maximumCandidatesPerRegion: number;
};

const GEOMETRY_EPSILON_MM = 1e-6;

/**
 * Finds exposure regions that do not inherit an eight-neighbour connection from
 * printable material on the layer below. Material on exposure layer zero is
 * treated as plate-anchored. A disconnected component is reported only where it first
 * appears; its continuation on later layers is still counted as affected but is
 * not repeatedly presented as a new failure.
 */
export function analyzeLayerConnectivity(
	layers: readonly BinaryLayerMask[],
	settings: ConnectivitySettings
): SupportTopologyAnalysis {
	return analyzeLayerConnectivityByIndex(layers.length, (index) => layers[index], settings);
}

function analyzeLayerConnectivityByIndex(
	layerCount: number,
	getLayer: (layerIndex: number) => BinaryLayerMask,
	settings: ConnectivitySettings
): SupportTopologyAnalysis {
	const first = layerCount > 0 ? getLayer(0) : undefined;
	if (!first) {
		return emptyAnalysis(settings.meshIsWatertightAtPixelSamples ?? true);
	}
	assertLayer(first);
	const size = first.width * first.height;
	let previousOccupied = new Uint8Array(size);
	let previousAnchored = new Uint8Array(size);
	const queue = new Uint32Array(size);
	let disconnectedRegionCount = 0;
	let disconnectedLayerCount = 0;
	let firstDisconnectedLayerIndex: number | null = null;
	const regions: DisconnectedPrintRegion[] = [];

	for (let layerIndex = 0; layerIndex < layerCount; layerIndex += 1) {
		const layer = layerIndex === 0 ? first : getLayer(layerIndex);
		assertLayer(layer);
		if (layer.width !== first.width || layer.height !== first.height) {
			throw new Error('Connectivity layers must have identical dimensions.');
		}
		const occupied = layer.data;
		const anchored = new Uint8Array(size);
		const visited = new Uint8Array(size);
		let layerHasDisconnectedMaterial = false;

		for (let start = 0; start < size; start += 1) {
			if (occupied[start] === 0 || visited[start] !== 0) continue;
			let head = 0;
			let tail = 1;
			let touchesPreviousMaterial = false;
			let touchesPreviousAnchor = layerIndex === 0;
			let sumX = 0;
			let sumY = 0;
			queue[0] = start;
			visited[start] = 1;

			while (head < tail) {
				const index = queue[head++];
				const x = index % first.width;
				const y = Math.floor(index / first.width);
				sumX += x;
				sumY += y;

				for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
					for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
						const neighborX = x + offsetX;
						const neighborY = y + offsetY;
						if (
							neighborX < 0 ||
							neighborX >= first.width ||
							neighborY < 0 ||
							neighborY >= first.height
						) {
							continue;
						}
						const neighbor = neighborY * first.width + neighborX;
						if (layerIndex > 0) {
							if (previousOccupied[neighbor] !== 0) touchesPreviousMaterial = true;
							if (previousAnchored[neighbor] !== 0) touchesPreviousAnchor = true;
						}
						if (occupied[neighbor] !== 0 && visited[neighbor] === 0) {
							visited[neighbor] = 1;
							queue[tail++] = neighbor;
						}
					}
				}
			}

			if (touchesPreviousAnchor) {
				for (let queueIndex = 0; queueIndex < tail; queueIndex += 1) {
					anchored[queue[queueIndex]] = 1;
				}
				continue;
			}

			layerHasDisconnectedMaterial = true;
			if (touchesPreviousMaterial) continue;
			disconnectedRegionCount += 1;
			firstDisconnectedLayerIndex ??= layerIndex;
			if (regions.length < MAX_REPORTED_DISCONNECTED_REGIONS) {
				regions.push({
					layerIndex,
					zMm: (layerIndex + 1) * settings.layerHeightMm,
					pixelCount: tail,
					areaMm2: tail * settings.pixelPitchMm.x * settings.pixelPitchMm.y,
					centroidMm: {
						x: (sumX / tail + 0.5) * settings.pixelPitchMm.x,
						y: (sumY / tail + 0.5) * settings.pixelPitchMm.y
					}
				});
			}
		}

		if (layerHasDisconnectedMaterial) disconnectedLayerCount += 1;
		previousOccupied = occupied.slice();
		previousAnchored = anchored;
		if (
			layerIndex % SUPPORT_TOPOLOGY_PROGRESS_LAYER_STRIDE === 0 ||
			layerIndex === layerCount - 1
		) {
			settings.onProgress?.(layerIndex + 1, layerCount);
		}
	}

	return {
		meshIsWatertightAtPixelSamples: settings.meshIsWatertightAtPixelSamples ?? true,
		analyzedLayerCount: layerCount,
		disconnectedRegionCount,
		disconnectedLayerCount,
		firstDisconnectedLayerIndex,
		firstDisconnectedZMm:
			firstDisconnectedLayerIndex === null
				? null
				: (firstDisconnectedLayerIndex + 1) * settings.layerHeightMm,
		regions,
		coverage: emptyCoverageAnalysis(),
		stability: { slenderSupportCount: 0, maximumSlendernessRatio: 0, risks: [] },
		bracing: { structures: [], beamCount: 0, unbracedSupportPointIds: [] }
	};
}

export function analyzeSupportCoverage(
	layers: readonly BinaryLayerMask[],
	supportPoints: readonly SupportPoint[],
	settings: CoverageSettings
): SupportCoverageAnalysis {
	return analyzeSupportCoverageByIndex(
		layers.length,
		(index) => layers[index],
		supportPoints,
		settings
	);
}

function analyzeSupportCoverageByIndex(
	layerCount: number,
	getLayer: (layerIndex: number) => BinaryLayerMask,
	supportPoints: readonly SupportPoint[],
	settings: CoverageSettings,
	onProgress?: SupportTopologyProgress
): SupportCoverageAnalysis {
	const missingContacts: CoverageContactCandidate[] = [];
	const risks: SupportCoverageRisk[] = [];
	let islandRiskCount = 0;
	let overhangRiskCount = 0;

	for (let layerIndex = 1; layerIndex < layerCount; layerIndex += 1) {
		const layerDelta = Math.min(settings.layerLookback, layerIndex);
		const currentMask = getLayer(layerIndex);
		const comparisonMask = getLayer(layerIndex - layerDelta);
		if (!masksAreEqual(currentMask, comparisonMask)) {
			const previousMask = layerDelta === 1 ? comparisonMask : getLayer(layerIndex - 1);
			const analysis = analyzeUnsupportedLayer(
				currentMask,
				comparisonMask,
				layerIndex,
				layerDelta,
				settings
			);
			const newIslandRegionIds = new Set(
				analysis.regions
					.filter(
						(region) =>
							region.kind === 'island' &&
							!region.pixelIndices.some((pixelIndex) => previousMask.data[pixelIndex] !== 0)
					)
					.map((region) => region.id)
			);

			for (const candidate of analysis.candidates) {
				const isNewIsland = newIslandRegionIds.has(candidate.regionId);
				if (isCoveredBySupportPoint(candidate, supportPoints, settings, isNewIsland)) continue;
				if (
					!isNewIsland &&
					isCoveredByCandidate(candidate, missingContacts, settings.coverageRadiusMm)
				) {
					continue;
				}

				missingContacts.push(candidate);
				if (candidate.kind === 'island') islandRiskCount += 1;
				else overhangRiskCount += 1;
				if (risks.length < MAX_REPORTED_COVERAGE_RISKS) {
					risks.push({
						layerIndex,
						zMm: candidate.positionMm.z,
						kind: candidate.kind,
						positionMm: { ...candidate.positionMm },
						coveredAreaMm2: candidate.coveredAreaMm2
					});
				}
			}
		}

		if (
			layerIndex % SUPPORT_TOPOLOGY_PROGRESS_LAYER_STRIDE === 0 ||
			layerIndex === layerCount - 1
		) {
			onProgress?.(layerIndex + 1, layerCount);
		}
	}

	return {
		missingContactCount: missingContacts.length,
		islandRiskCount,
		overhangRiskCount,
		coverageRadiusMm: settings.coverageRadiusMm,
		risks
	};
}

export function analyzeSupportStability(
	structures: readonly SupportStructure[]
): SupportStabilityAnalysis {
	const risks: SlenderSupportRisk[] = [];
	let maximumSlendernessRatio = 0;

	for (const structure of structures) {
		for (const part of structure.parts) {
			if (part.kind !== 'shaft') continue;
			const shaftLengthMm = Math.hypot(
				part.end.x - part.start.x,
				part.end.y - part.start.y,
				part.end.z - part.start.z
			);
			const shaftDiameterMm = Math.max(part.startDiameter, part.endDiameter);
			const slendernessRatio = shaftLengthMm / shaftDiameterMm;
			maximumSlendernessRatio = Math.max(maximumSlendernessRatio, slendernessRatio);
			if (slendernessRatio < SUPPORT_SHAFT_SLENDERNESS_WARNING_RATIO) continue;
			risks.push({
				supportPointId: structure.pointIds[0] ?? structure.id,
				shaftLengthMm,
				shaftDiameterMm,
				slendernessRatio
			});
		}
	}

	risks.sort((left, right) => right.slendernessRatio - left.slendernessRatio);
	return { slenderSupportCount: risks.length, maximumSlendernessRatio, risks };
}

function masksAreEqual(left: BinaryLayerMask, right: BinaryLayerMask): boolean {
	if (left.width !== right.width || left.height !== right.height) return false;
	for (let index = 0; index < left.data.length; index += 1) {
		if (left.data[index] !== right.data[index]) return false;
	}
	return true;
}

function isCoveredBySupportPoint(
	candidate: CoverageContactCandidate,
	supportPoints: readonly SupportPoint[],
	settings: CoverageSettings,
	isNewIsland: boolean
): boolean {
	const radiusSquared = settings.coverageRadiusMm ** 2 + GEOMETRY_EPSILON_MM;
	return supportPoints.some((point) => {
		const verticalDistance = candidate.positionMm.z - point.position.z;
		if (verticalDistance < -GEOMETRY_EPSILON_MM) return false;
		if (isNewIsland && verticalDistance > (settings.layerLookback + 1) * settings.layerHeightMm) {
			return false;
		}
		return (
			(point.position.x - candidate.positionMm.x) ** 2 +
				(point.position.y - candidate.positionMm.y) ** 2 <=
			radiusSquared
		);
	});
}

function isCoveredByCandidate(
	candidate: CoverageContactCandidate,
	earlierCandidates: readonly CoverageContactCandidate[],
	radiusMm: number
): boolean {
	const radiusSquared = radiusMm ** 2 + GEOMETRY_EPSILON_MM;
	return earlierCandidates.some(
		(earlier) =>
			earlier.positionMm.z <= candidate.positionMm.z + GEOMETRY_EPSILON_MM &&
			(earlier.positionMm.x - candidate.positionMm.x) ** 2 +
				(earlier.positionMm.y - candidate.positionMm.y) ** 2 <=
				radiusSquared
	);
}

export function analyzeSupportTopology(
	input: SupportTopologyInput,
	onProgress?: SupportTopologyProgress
): SupportTopologyAnalysis {
	const rasterizer = new LayerCoverageRasterizer(
		input.model,
		input.translation,
		input.rotation,
		input.supportPlan,
		input.raftIslands,
		undefined,
		1,
		input.scale
	);
	const topology = analyzeLayerConnectivityByIndex(
		rasterizer.layerCount,
		(layerIndex) => {
			const coverage = rasterizer.coverageMask(layerIndex);
			const data = new Uint8Array(coverage.data.length);
			for (let index = 0; index < data.length; index += 1) {
				data[index] = coverage.data[index] >= 0.5 ? 1 : 0;
			}
			return { width: coverage.width, height: coverage.height, data };
		},
		{
			pixelPitchMm: rasterizer.pixelPitchMm,
			layerHeightMm: rasterizer.layerHeightMm,
			meshIsWatertightAtPixelSamples: rasterizer.diagnostics.meshIsWatertightAtPixelSamples,
			onProgress: (completed, total) => onProgress?.(completed, total * 2)
		}
	);
	const resolvedPointIds = new Set(
		input.supportPlan.structures.flatMap((structure) => [...structure.pointIds])
	);
	const coverageSettings: CoverageSettings = {
		pixelPitchMm: rasterizer.pixelPitchMm.x,
		layerHeightMm: rasterizer.layerHeightMm,
		layerLookback: DEFAULT_AUTO_SUPPORT_SETTINGS.layerLookback,
		overhangAngleDegrees: DEFAULT_AUTO_SUPPORT_SETTINGS.overhangAngleDegrees,
		minimumOverhangAreaMm2: DEFAULT_AUTO_SUPPORT_SETTINGS.minimumOverhangAreaMm2,
		coverageRadiusMm: DEFAULT_AUTO_SUPPORT_SETTINGS.coverageRadiusMm,
		maximumCandidatesPerRegion: DEFAULT_AUTO_SUPPORT_SETTINGS.maximumCandidatesPerRegion ?? 128
	};
	const coverage = analyzeSupportCoverageByIndex(
		rasterizer.layerCount,
		(layerIndex) => rasterizer.modelMask(layerIndex),
		input.supportPoints.filter((point) => resolvedPointIds.has(point.id)),
		coverageSettings,
		(completed, total) => onProgress?.(total + completed, total * 2)
	);

	const stability = analyzeSupportStability(input.supportPlan.structures);
	const riskySupportPointIds = stability.risks.map((risk) => risk.supportPointId);
	// Connectivity and watertightness describe the model/support union, not whether
	// two already-resolved posts can be braced. Keep proposing collision-free beams
	// even when another part of the print has an island or the sampled mesh is open.
	const bracing = generateSupportBracingPlan(
		input.supportPlan.structures,
		new Set(riskySupportPointIds),
		(start, end, radiusMm) => braceIntersectsModel(rasterizer, start, end, radiusMm)
	);

	return {
		...topology,
		coverage,
		stability,
		bracing
	};
}

function braceIntersectsModel(
	rasterizer: LayerCoverageRasterizer,
	start: Point3,
	end: Point3,
	radiusMm: number
): boolean {
	const dx = end.x - start.x;
	const dy = end.y - start.y;
	const dz = end.z - start.z;
	const lengthMm = Math.hypot(dx, dy, dz);
	const sampleStepMm = Math.min(rasterizer.pixelPitchMm.x, rasterizer.pixelPitchMm.y, 0.1);
	const sampleCount = Math.max(1, Math.ceil(lengthMm / sampleStepMm));
	const pixelHalfDiagonalMm = Math.hypot(
		rasterizer.pixelPitchMm.x / 2,
		rasterizer.pixelPitchMm.y / 2
	);
	const testRadiusMm = radiusMm + pixelHalfDiagonalMm;

	for (let sampleIndex = 0; sampleIndex <= sampleCount; sampleIndex += 1) {
		const t = sampleIndex / sampleCount;
		const x = start.x + dx * t;
		const y = start.y + dy * t;
		const z = start.z + dz * t;
		const minimumColumn = Math.max(0, Math.floor((x - testRadiusMm) / rasterizer.pixelPitchMm.x));
		const maximumColumn = Math.min(
			rasterizer.width - 1,
			Math.floor((x + testRadiusMm) / rasterizer.pixelPitchMm.x)
		);
		const minimumRow = Math.max(0, Math.floor((y - testRadiusMm) / rasterizer.pixelPitchMm.y));
		const maximumRow = Math.min(
			rasterizer.height - 1,
			Math.floor((y + testRadiusMm) / rasterizer.pixelPitchMm.y)
		);

		for (let row = minimumRow; row <= maximumRow; row += 1) {
			const sampleY = (row + 0.5) * rasterizer.pixelPitchMm.y;
			for (let column = minimumColumn; column <= maximumColumn; column += 1) {
				const sampleX = (column + 0.5) * rasterizer.pixelPitchMm.x;
				if ((sampleX - x) ** 2 + (sampleY - y) ** 2 > testRadiusMm ** 2) continue;
				if (
					rasterizer
						.modelIntervalsAtPixel(column, row)
						.some(
							(interval) =>
								interval.minimumZMm < z + radiusMm - GEOMETRY_EPSILON_MM &&
								interval.maximumZMm > z - radiusMm + GEOMETRY_EPSILON_MM
						)
				) {
					return true;
				}
			}
		}
	}
	return false;
}

function assertLayer(layer: BinaryLayerMask) {
	if (
		!Number.isInteger(layer.width) ||
		layer.width <= 0 ||
		!Number.isInteger(layer.height) ||
		layer.height <= 0 ||
		layer.data.length !== layer.width * layer.height
	) {
		throw new Error('Invalid connectivity layer mask.');
	}
}

function emptyAnalysis(meshIsWatertightAtPixelSamples: boolean): SupportTopologyAnalysis {
	return {
		meshIsWatertightAtPixelSamples,
		analyzedLayerCount: 0,
		disconnectedRegionCount: 0,
		disconnectedLayerCount: 0,
		firstDisconnectedLayerIndex: null,
		firstDisconnectedZMm: null,
		regions: [],
		coverage: emptyCoverageAnalysis(),
		stability: { slenderSupportCount: 0, maximumSlendernessRatio: 0, risks: [] },
		bracing: { structures: [], beamCount: 0, unbracedSupportPointIds: [] }
	};
}

function emptyCoverageAnalysis(): SupportCoverageAnalysis {
	return {
		missingContactCount: 0,
		islandRiskCount: 0,
		overhangRiskCount: 0,
		coverageRadiusMm: DEFAULT_AUTO_SUPPORT_SETTINGS.coverageRadiusMm,
		risks: []
	};
}
