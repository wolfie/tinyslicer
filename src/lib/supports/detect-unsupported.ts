/** Any non-zero data value is treated as exposed model material. */
export type BinaryLayerMask = {
	width: number;
	height: number;
	data: Uint8Array;
};

export type UnsupportedRegionKind = 'island' | 'overhang';

export type UnsupportedDetectionSettings = {
	pixelPitchMm: number;
	layerHeightMm: number;
	overhangAngleDegrees: number;
	minimumOverhangAreaMm2: number;
	coverageRadiusMm: number;
	maximumCandidatesPerRegion?: number;
};

export type UnsupportedRegion = {
	id: string;
	layerIndex: number;
	kind: UnsupportedRegionKind;
	pixelIndices: Uint32Array;
	pixelCount: number;
	areaMm2: number;
	requiresContact: boolean;
	bounds: {
		minX: number;
		minY: number;
		maxX: number;
		maxY: number;
	};
};

export type CoverageContactCandidate = {
	id: string;
	regionId: string;
	layerIndex: number;
	kind: UnsupportedRegionKind;
	pixel: { x: number; y: number };
	positionMm: { x: number; y: number; z: number };
	coverageRadiusMm: number;
	coveredPixelCount: number;
	coveredAreaMm2: number;
};

export type UnsupportedLayerAnalysis = {
	layerIndex: number;
	comparisonLayerIndex: number;
	allowanceMm: number;
	supportableMask: BinaryLayerMask;
	unsupportedMask: BinaryLayerMask;
	regions: readonly UnsupportedRegion[];
	candidates: readonly CoverageContactCandidate[];
	incompleteRegionIds: readonly string[];
};

type ConnectedComponents = {
	labels: Int32Array;
	pixelIndices: number[][];
};

const DISTANCE_EPSILON = 1e-9;
const DEFAULT_MAXIMUM_CANDIDATES_PER_REGION = 4096;
const CARDINAL_DISTANCE = 1;
const DIAGONAL_DISTANCE = Math.SQRT2;

function assertPositiveFinite(value: number, name: string) {
	if (!Number.isFinite(value) || value <= 0) {
		throw new Error(`${name} must be a positive finite number.`);
	}
}

function assertMask(mask: BinaryLayerMask, name: string) {
	if (!Number.isInteger(mask.width) || mask.width <= 0) {
		throw new Error(`${name}.width must be a positive integer.`);
	}
	if (!Number.isInteger(mask.height) || mask.height <= 0) {
		throw new Error(`${name}.height must be a positive integer.`);
	}
	if (mask.data.length !== mask.width * mask.height) {
		throw new Error(`${name}.data length does not match its dimensions.`);
	}
}

function assertSettings(settings: UnsupportedDetectionSettings) {
	assertPositiveFinite(settings.pixelPitchMm, 'pixelPitchMm');
	assertPositiveFinite(settings.layerHeightMm, 'layerHeightMm');
	assertPositiveFinite(settings.coverageRadiusMm, 'coverageRadiusMm');
	if (
		!Number.isFinite(settings.overhangAngleDegrees) ||
		settings.overhangAngleDegrees <= 0 ||
		settings.overhangAngleDegrees >= 90
	) {
		throw new Error('overhangAngleDegrees must be between 0 and 90 degrees.');
	}
	if (!Number.isFinite(settings.minimumOverhangAreaMm2) || settings.minimumOverhangAreaMm2 < 0) {
		throw new Error('minimumOverhangAreaMm2 must be a non-negative finite number.');
	}
	if (
		settings.maximumCandidatesPerRegion !== undefined &&
		(!Number.isInteger(settings.maximumCandidatesPerRegion) ||
			settings.maximumCandidatesPerRegion <= 0)
	) {
		throw new Error('maximumCandidatesPerRegion must be a positive integer.');
	}
}

function emptyMask(width: number, height: number): BinaryLayerMask {
	return { width, height, data: new Uint8Array(width * height) };
}

function circleOffsets(radiusPixels: number): readonly [number, number][] {
	const offsets: [number, number][] = [];
	const extent = Math.ceil(radiusPixels);
	const radiusSquared = radiusPixels * radiusPixels + DISTANCE_EPSILON;

	for (let y = -extent; y <= extent; y += 1) {
		for (let x = -extent; x <= extent; x += 1) {
			if (x * x + y * y <= radiusSquared) offsets.push([x, y]);
		}
	}

	return offsets;
}

export function dilateBinaryMask(mask: BinaryLayerMask, radiusPixels: number): BinaryLayerMask {
	assertMask(mask, 'mask');
	if (!Number.isFinite(radiusPixels) || radiusPixels < 0) {
		throw new Error('radiusPixels must be a non-negative finite number.');
	}

	const result = emptyMask(mask.width, mask.height);
	const offsets = circleOffsets(radiusPixels);

	for (let index = 0; index < mask.data.length; index += 1) {
		if (mask.data[index] === 0) continue;
		const sourceX = index % mask.width;
		const sourceY = Math.floor(index / mask.width);

		for (const [offsetX, offsetY] of offsets) {
			const x = sourceX + offsetX;
			const y = sourceY + offsetY;
			if (x < 0 || x >= mask.width || y < 0 || y >= mask.height) continue;
			result.data[y * mask.width + x] = 1;
		}
	}

	return result;
}

function labelConnectedComponents(
	data: Uint8Array,
	width: number,
	height: number
): ConnectedComponents {
	const labels = new Int32Array(data.length);
	labels.fill(-1);
	const pixelIndices: number[][] = [];
	const queue = new Uint32Array(data.length);

	for (let start = 0; start < data.length; start += 1) {
		if (data[start] === 0 || labels[start] !== -1) continue;

		const componentId = pixelIndices.length;
		const component: number[] = [];
		let head = 0;
		let tail = 1;
		queue[0] = start;
		labels[start] = componentId;

		while (head < tail) {
			const index = queue[head++];
			component.push(index);
			const x = index % width;
			const y = Math.floor(index / width);

			for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
				for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
					if (offsetX === 0 && offsetY === 0) continue;
					const neighborX = x + offsetX;
					const neighborY = y + offsetY;
					if (neighborX < 0 || neighborX >= width || neighborY < 0 || neighborY >= height) {
						continue;
					}
					const neighbor = neighborY * width + neighborX;
					if (data[neighbor] === 0 || labels[neighbor] !== -1) continue;
					labels[neighbor] = componentId;
					queue[tail++] = neighbor;
				}
			}
		}

		pixelIndices.push(component);
	}

	return { labels, pixelIndices };
}

function regionBounds(pixelIndices: readonly number[], width: number): UnsupportedRegion['bounds'] {
	let minX = Infinity;
	let minY = Infinity;
	let maxX = -Infinity;
	let maxY = -Infinity;

	for (const index of pixelIndices) {
		const x = index % width;
		const y = Math.floor(index / width);
		minX = Math.min(minX, x);
		minY = Math.min(minY, y);
		maxX = Math.max(maxX, x);
		maxY = Math.max(maxY, y);
	}

	return { minX, minY, maxX, maxY };
}

function distancesToRegionBoundary(region: UnsupportedRegion, maskWidth: number): Float32Array {
	const localWidth = region.bounds.maxX - region.bounds.minX + 3;
	const localHeight = region.bounds.maxY - region.bounds.minY + 3;
	const localDistances = new Float32Array(localWidth * localHeight);

	for (const pixelIndex of region.pixelIndices) {
		const x = (pixelIndex % maskWidth) - region.bounds.minX + 1;
		const y = Math.floor(pixelIndex / maskWidth) - region.bounds.minY + 1;
		localDistances[y * localWidth + x] = Number.POSITIVE_INFINITY;
	}

	for (let y = 1; y < localHeight - 1; y += 1) {
		for (let x = 1; x < localWidth - 1; x += 1) {
			const index = y * localWidth + x;
			if (localDistances[index] === 0) continue;
			localDistances[index] = Math.min(
				localDistances[index],
				localDistances[index - 1] + CARDINAL_DISTANCE,
				localDistances[index - localWidth] + CARDINAL_DISTANCE,
				localDistances[index - localWidth - 1] + DIAGONAL_DISTANCE,
				localDistances[index - localWidth + 1] + DIAGONAL_DISTANCE
			);
		}
	}

	for (let y = localHeight - 2; y >= 1; y -= 1) {
		for (let x = localWidth - 2; x >= 1; x -= 1) {
			const index = y * localWidth + x;
			if (localDistances[index] === 0) continue;
			localDistances[index] = Math.min(
				localDistances[index],
				localDistances[index + 1] + CARDINAL_DISTANCE,
				localDistances[index + localWidth] + CARDINAL_DISTANCE,
				localDistances[index + localWidth - 1] + DIAGONAL_DISTANCE,
				localDistances[index + localWidth + 1] + DIAGONAL_DISTANCE
			);
		}
	}

	const result = new Float32Array(region.pixelCount);
	for (let pixelOffset = 0; pixelOffset < region.pixelIndices.length; pixelOffset += 1) {
		const pixelIndex = region.pixelIndices[pixelOffset];
		const x = (pixelIndex % maskWidth) - region.bounds.minX + 1;
		const y = Math.floor(pixelIndex / maskWidth) - region.bounds.minY + 1;
		result[pixelOffset] = localDistances[y * localWidth + x];
	}
	return result;
}

/** Greedily covers one region, recomputing an interior distance transform after every pick. */
export function suggestCoverageContacts(
	region: UnsupportedRegion,
	maskWidth: number,
	settings: UnsupportedDetectionSettings
): { candidates: CoverageContactCandidate[]; uncoveredPixelCount: number } {
	assertSettings(settings);
	if (!Number.isInteger(maskWidth) || maskWidth <= 0) {
		throw new Error('maskWidth must be a positive integer.');
	}
	if (!region.requiresContact || region.pixelCount === 0) {
		return { candidates: [], uncoveredPixelCount: 0 };
	}

	const radiusPixels = settings.coverageRadiusMm / settings.pixelPitchMm;
	const radiusSquared = radiusPixels * radiusPixels + DISTANCE_EPSILON;
	const maximumCandidates =
		settings.maximumCandidatesPerRegion ?? DEFAULT_MAXIMUM_CANDIDATES_PER_REGION;
	const uncovered = new Uint8Array(region.pixelCount);
	uncovered.fill(1);
	let uncoveredPixelCount = region.pixelCount;
	const candidates: CoverageContactCandidate[] = [];

	while (uncoveredPixelCount > 0 && candidates.length < maximumCandidates) {
		const uncoveredPixelIndices: number[] = [];
		for (let pixelOffset = 0; pixelOffset < region.pixelIndices.length; pixelOffset += 1) {
			if (uncovered[pixelOffset] !== 0) {
				uncoveredPixelIndices.push(region.pixelIndices[pixelOffset]);
			}
		}
		const uncoveredRegion: UnsupportedRegion = {
			...region,
			pixelIndices: Uint32Array.from(uncoveredPixelIndices),
			pixelCount: uncoveredPixelIndices.length,
			bounds: regionBounds(uncoveredPixelIndices, maskWidth)
		};
		const boundaryDistances = distancesToRegionBoundary(uncoveredRegion, maskWidth);
		let bestPixelOffset = -1;
		let bestDistance = -Infinity;
		let bestPixelIndex = Infinity;

		for (let pixelOffset = 0; pixelOffset < uncoveredRegion.pixelIndices.length; pixelOffset += 1) {
			const distance = boundaryDistances[pixelOffset];
			const pixelIndex = uncoveredRegion.pixelIndices[pixelOffset];
			if (
				distance > bestDistance + DISTANCE_EPSILON ||
				(Math.abs(distance - bestDistance) <= DISTANCE_EPSILON && pixelIndex < bestPixelIndex)
			) {
				bestPixelOffset = pixelOffset;
				bestDistance = distance;
				bestPixelIndex = pixelIndex;
			}
		}

		if (bestPixelOffset < 0) break;
		const centerX = bestPixelIndex % maskWidth;
		const centerY = Math.floor(bestPixelIndex / maskWidth);
		let coveredPixelCount = 0;

		for (let pixelOffset = 0; pixelOffset < region.pixelIndices.length; pixelOffset += 1) {
			if (uncovered[pixelOffset] === 0) continue;
			const pixelIndex = region.pixelIndices[pixelOffset];
			const deltaX = (pixelIndex % maskWidth) - centerX;
			const deltaY = Math.floor(pixelIndex / maskWidth) - centerY;
			if (deltaX * deltaX + deltaY * deltaY > radiusSquared) continue;
			uncovered[pixelOffset] = 0;
			uncoveredPixelCount -= 1;
			coveredPixelCount += 1;
		}

		candidates.push({
			id: `${region.id}:candidate-${candidates.length + 1}`,
			regionId: region.id,
			layerIndex: region.layerIndex,
			kind: region.kind,
			pixel: { x: centerX, y: centerY },
			positionMm: {
				x: (centerX + 0.5) * settings.pixelPitchMm,
				y: (centerY + 0.5) * settings.pixelPitchMm,
				z: (region.layerIndex + 1) * settings.layerHeightMm
			},
			coverageRadiusMm: settings.coverageRadiusMm,
			coveredPixelCount,
			coveredAreaMm2: coveredPixelCount * settings.pixelPitchMm ** 2
		});
	}

	return { candidates, uncoveredPixelCount };
}

/**
 * Compares a zero-based layer with an earlier mask. Layer zero is the first
 * exported exposure at one layer height and should be treated as plate-supported
 * by the eventual sequence analyzer rather than passed to this function.
 */
export function analyzeUnsupportedLayer(
	currentMask: BinaryLayerMask,
	comparisonMask: BinaryLayerMask,
	layerIndex: number,
	layerDelta: number,
	settings: UnsupportedDetectionSettings
): UnsupportedLayerAnalysis {
	assertMask(currentMask, 'currentMask');
	assertMask(comparisonMask, 'comparisonMask');
	assertSettings(settings);
	if (currentMask.width !== comparisonMask.width || currentMask.height !== comparisonMask.height) {
		throw new Error('Layer masks must have identical dimensions.');
	}
	if (!Number.isInteger(layerIndex) || layerIndex < 1) {
		throw new Error('layerIndex must be a positive zero-based layer index.');
	}
	if (!Number.isInteger(layerDelta) || layerDelta < 1 || layerDelta > layerIndex) {
		throw new Error('layerDelta must be between 1 and layerIndex.');
	}

	const allowanceMm =
		(layerDelta * settings.layerHeightMm) /
		Math.tan((settings.overhangAngleDegrees * Math.PI) / 180);
	const supportableMask = dilateBinaryMask(comparisonMask, allowanceMm / settings.pixelPitchMm);
	const unsupportedMask = emptyMask(currentMask.width, currentMask.height);

	for (let index = 0; index < currentMask.data.length; index += 1) {
		if (currentMask.data[index] !== 0 && supportableMask.data[index] === 0) {
			unsupportedMask.data[index] = 1;
		}
	}

	const currentComponents = labelConnectedComponents(
		currentMask.data,
		currentMask.width,
		currentMask.height
	);
	const currentComponentHasInheritedSupport = currentComponents.pixelIndices.map((component) =>
		component.some((index) => supportableMask.data[index] !== 0)
	);
	const unsupportedComponents = labelConnectedComponents(
		unsupportedMask.data,
		unsupportedMask.width,
		unsupportedMask.height
	);
	const pixelAreaMm2 = settings.pixelPitchMm ** 2;
	const regions: UnsupportedRegion[] = unsupportedComponents.pixelIndices.map(
		(component, regionIndex) => {
			const currentComponentId = currentComponents.labels[component[0]];
			const kind: UnsupportedRegionKind = currentComponentHasInheritedSupport[currentComponentId]
				? 'overhang'
				: 'island';
			const areaMm2 = component.length * pixelAreaMm2;
			return {
				id: `layer-${layerIndex}:region-${regionIndex + 1}`,
				layerIndex,
				kind,
				pixelIndices: Uint32Array.from(component),
				pixelCount: component.length,
				areaMm2,
				requiresContact:
					kind === 'island' || areaMm2 + DISTANCE_EPSILON >= settings.minimumOverhangAreaMm2,
				bounds: regionBounds(component, currentMask.width)
			};
		}
	);
	const candidates: CoverageContactCandidate[] = [];
	const incompleteRegionIds: string[] = [];

	for (const region of regions) {
		const coverage = suggestCoverageContacts(region, currentMask.width, settings);
		candidates.push(...coverage.candidates);
		if (coverage.uncoveredPixelCount > 0) incompleteRegionIds.push(region.id);
	}

	return {
		layerIndex,
		comparisonLayerIndex: layerIndex - layerDelta,
		allowanceMm,
		supportableMask,
		unsupportedMask,
		regions,
		candidates,
		incompleteRegionIds
	};
}
