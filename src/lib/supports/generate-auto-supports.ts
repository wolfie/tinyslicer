import type { LayerMaskRasterizationProfile } from '$lib/slicing/model-layer-masks';
import {
	ModelLayerMaskRasterizer,
	TINYMAKER_LAYER_MASK_PROFILE
} from '$lib/slicing/model-layer-masks';
import type { ModelRotation, ModelTranslation } from '$lib/workspace/build-volume-renderer/types';
import type { ImportedStlModel } from '$lib/workspace/stl-importer';
import {
	createPostSupportStructure,
	SUPPORT_NECK_LENGTH_MM,
	type ModelSurfaceHit
} from '$lib/workspace/supports';
import {
	analyzeUnsupportedLayer,
	type BinaryLayerMask,
	type UnsupportedDetectionSettings
} from './detect-unsupported';

export type AutoSupportSettings = Omit<
	UnsupportedDetectionSettings,
	'pixelPitchMm' | 'layerHeightMm'
> & {
	layerLookback: number;
	maximumSupportPoints: number;
};

export type AutoSupportDiagnostics = {
	meshIsWatertightAtPixelSamples: boolean;
	oddIntersectionPixelCount: number;
	analyzedLayerCount: number;
	regionCount: number;
	candidateCount: number;
	rejectedCandidateCount: number;
	truncated: boolean;
};

export type AutoSupportResult = {
	hits: readonly ModelSurfaceHit[];
	diagnostics: AutoSupportDiagnostics;
};

export const DEFAULT_AUTO_SUPPORT_SETTINGS: AutoSupportSettings = {
	layerLookback: 3,
	overhangAngleDegrees: 45,
	minimumOverhangAreaMm2: 0.25,
	coverageRadiusMm: 3,
	maximumCandidatesPerRegion: 128,
	maximumSupportPoints: 256
};

const GEOMETRY_EPSILON_MM = 1e-6;
const LAYER_INDEX_EPSILON = 1e-6;

function assertAutoSupportSettings(settings: AutoSupportSettings) {
	if (!Number.isInteger(settings.layerLookback) || settings.layerLookback <= 0) {
		throw new Error('layerLookback must be a positive integer.');
	}
	if (!Number.isInteger(settings.maximumSupportPoints) || settings.maximumSupportPoints <= 0) {
		throw new Error('maximumSupportPoints must be a positive integer.');
	}
}

function masksAreEqual(left: BinaryLayerMask, right: BinaryLayerMask): boolean {
	if (left.width !== right.width || left.height !== right.height) return false;
	for (let index = 0; index < left.data.length; index += 1) {
		if (left.data[index] !== right.data[index]) return false;
	}
	return true;
}

function isCoveredByEarlierContact(
	candidate: { x: number; y: number; z: number },
	hits: readonly ModelSurfaceHit[],
	radiusMm: number
): boolean {
	const radiusSquared = radiusMm * radiusMm;
	return hits.some(
		(hit) =>
			hit.position.z <= candidate.z + GEOMETRY_EPSILON_MM &&
			(hit.position.x - candidate.x) ** 2 + (hit.position.y - candidate.y) ** 2 <=
				radiusSquared + GEOMETRY_EPSILON_MM
	);
}

function contactForCandidate(
	rasterizer: ModelLayerMaskRasterizer,
	layerIndex: number,
	pixel: { x: number; y: number }
): ModelSurfaceHit | null {
	const intervals = rasterizer.verticalIntervalsAtPixel(pixel.x, pixel.y);
	const layerZMm = rasterizer.layerZMm(layerIndex);
	const contactInterval = intervals.find(
		(interval) =>
			layerZMm + GEOMETRY_EPSILON_MM >= interval.minimumZMm &&
			layerZMm - GEOMETRY_EPSILON_MM <= interval.maximumZMm
	);
	if (!contactInterval) return null;

	const position = {
		x: (pixel.x + 0.5) * rasterizer.pixelPitchMm.x,
		y: (pixel.y + 0.5) * rasterizer.pixelPitchMm.y,
		z: contactInterval.minimumZMm
	};
	const neckBaseZ = position.z - SUPPORT_NECK_LENGTH_MM;
	let lowerContactPosition: ModelSurfaceHit['lowerContactPosition'];
	for (let index = intervals.length - 1; index >= 0; index -= 1) {
		const interval = intervals[index];
		if (interval.maximumZMm >= position.z - GEOMETRY_EPSILON_MM) continue;
		if (interval.maximumZMm < neckBaseZ - GEOMETRY_EPSILON_MM) {
			lowerContactPosition = { x: position.x, y: position.y, z: interval.maximumZMm };
			break;
		}
	}

	return {
		position,
		normal: { x: 0, y: 0, z: -1 },
		...(lowerContactPosition ? { lowerContactPosition } : {})
	};
}

/**
 * Produces a conservative, deterministic first draft of support contacts.
 * The result is intentionally limited and uses the same editable post geometry
 * as manual support placement; it is not a promise that the model is printable.
 */
export function generateAutoSupportHits(
	model: Pick<ImportedStlModel, 'positions' | 'bounds'>,
	translation: ModelTranslation,
	rotation: ModelRotation,
	settings: AutoSupportSettings = DEFAULT_AUTO_SUPPORT_SETTINGS,
	profile: LayerMaskRasterizationProfile = TINYMAKER_LAYER_MASK_PROFILE
): AutoSupportResult {
	assertAutoSupportSettings(settings);
	const rasterizer = new ModelLayerMaskRasterizer(model, translation, rotation, profile);
	const diagnostics: AutoSupportDiagnostics = {
		meshIsWatertightAtPixelSamples: rasterizer.diagnostics.oddIntersectionPixelCount === 0,
		oddIntersectionPixelCount: rasterizer.diagnostics.oddIntersectionPixelCount,
		analyzedLayerCount: 0,
		regionCount: 0,
		candidateCount: 0,
		rejectedCandidateCount: 0,
		truncated: false
	};
	if (!diagnostics.meshIsWatertightAtPixelSamples || rasterizer.layerCount < 2) {
		return { hits: [], diagnostics };
	}

	const detectionSettings: UnsupportedDetectionSettings = {
		pixelPitchMm: rasterizer.pixelPitchMm.x,
		layerHeightMm: rasterizer.layerHeightMm,
		overhangAngleDegrees: settings.overhangAngleDegrees,
		minimumOverhangAreaMm2: settings.minimumOverhangAreaMm2,
		coverageRadiusMm: settings.coverageRadiusMm,
		maximumCandidatesPerRegion: settings.maximumCandidatesPerRegion
	};
	const hits: ModelSurfaceHit[] = [];
	const firstOccupiedLayerIndex = Math.max(
		1,
		Math.ceil(rasterizer.transformedBounds.min.z / rasterizer.layerHeightMm - LAYER_INDEX_EPSILON) -
			1
	);

	layerLoop: for (
		let layerIndex = firstOccupiedLayerIndex;
		layerIndex < rasterizer.layerCount;
		layerIndex += 1
	) {
		const layerDelta = Math.min(settings.layerLookback, layerIndex);
		const currentMask = rasterizer.createLayerMask(layerIndex);
		const comparisonMask = rasterizer.createLayerMask(layerIndex - layerDelta);
		if (masksAreEqual(currentMask, comparisonMask)) continue;
		const previousMask =
			layerDelta === 1 ? comparisonMask : rasterizer.createLayerMask(layerIndex - 1);

		const analysis = analyzeUnsupportedLayer(
			currentMask,
			comparisonMask,
			layerIndex,
			layerDelta,
			detectionSettings
		);
		diagnostics.analyzedLayerCount += 1;
		diagnostics.regionCount += analysis.regions.length;
		diagnostics.candidateCount += analysis.candidates.length;
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
			if (
				!newIslandRegionIds.has(candidate.regionId) &&
				isCoveredByEarlierContact(candidate.positionMm, hits, settings.coverageRadiusMm)
			) {
				continue;
			}

			const hit = contactForCandidate(rasterizer, layerIndex, candidate.pixel);
			if (!hit || !createPostSupportStructure({ id: 'candidate', ...hit })) {
				diagnostics.rejectedCandidateCount += 1;
				continue;
			}
			hits.push(hit);
			if (hits.length >= settings.maximumSupportPoints) {
				diagnostics.truncated = true;
				break layerLoop;
			}
		}
	}

	return { hits, diagnostics };
}
