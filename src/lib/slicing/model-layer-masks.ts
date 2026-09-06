import { Vector3 } from 'three';

import { TINYMAKER_PROFILE } from '$lib/printer/tinymaker';
import type { BinaryLayerMask } from '$lib/supports/detect-unsupported';
import type { ImportedStlModel } from '$lib/workspace/stl-importer';
import {
	IDENTITY_MODEL_ROTATION,
	modelRotationQuaternion,
	transformModelGeometryBounds,
	ZERO_MODEL_TRANSLATION
} from '$lib/workspace/build-volume-renderer/model-transform';
import type { ModelRotation, ModelTranslation } from '$lib/workspace/build-volume-renderer/types';

export type LayerMaskRasterizationProfile = {
	resolution: { x: number; y: number };
	buildAreaMm: { x: number; y: number };
	layerHeightMm: number;
};

export type LayerMaskRasterizationDiagnostics = {
	triangleCount: number;
	projectedTriangleCount: number;
	verticalTriangleCount: number;
	intersectedPixelCount: number;
	oddIntersectionPixelCount: number;
};

export type VerticalModelInterval = {
	minimumZMm: number;
	maximumZMm: number;
};

type ProjectedVertex = { x: number; y: number; z: number };
type OrientedCrossing = { z: number; windingDelta: -1 | 1 };

const COORDINATE_EPSILON = 1e-9;
const CROSSING_MERGE_EPSILON_MM = 1e-6;
const LAYER_COUNT_EPSILON = 1e-6;

export const TINYMAKER_LAYER_MASK_PROFILE: LayerMaskRasterizationProfile = {
	resolution: TINYMAKER_PROFILE.resolution,
	buildAreaMm: {
		x: TINYMAKER_PROFILE.buildVolume.x,
		y: TINYMAKER_PROFILE.buildVolume.y
	},
	layerHeightMm: TINYMAKER_PROFILE.layerHeight
};

function assertPositiveFinite(value: number, name: string) {
	if (!Number.isFinite(value) || value <= 0) {
		throw new Error(`${name} must be a positive finite number.`);
	}
}

function assertProfile(profile: LayerMaskRasterizationProfile) {
	if (!Number.isInteger(profile.resolution.x) || profile.resolution.x <= 0) {
		throw new Error('resolution.x must be a positive integer.');
	}
	if (!Number.isInteger(profile.resolution.y) || profile.resolution.y <= 0) {
		throw new Error('resolution.y must be a positive integer.');
	}
	assertPositiveFinite(profile.buildAreaMm.x, 'buildAreaMm.x');
	assertPositiveFinite(profile.buildAreaMm.y, 'buildAreaMm.y');
	assertPositiveFinite(profile.layerHeightMm, 'layerHeightMm');
}

function edge(start: ProjectedVertex, end: ProjectedVertex, x: number, y: number): number {
	return (end.x - start.x) * (y - start.y) - (end.y - start.y) * (x - start.x);
}

/**
 * A half-open edge rule ensures two triangles sharing a projected edge do not
 * both contribute the same surface crossing.
 */
function includesEdge(start: ProjectedVertex, end: ProjectedVertex): boolean {
	return start.y < end.y || (start.y === end.y && start.x > end.x);
}

function isInsideEdge(value: number, inclusive: boolean, tolerance: number): boolean {
	return value > tolerance || (Math.abs(value) <= tolerance && inclusive);
}

function clamp(value: number, minimum: number, maximum: number): number {
	return Math.max(minimum, Math.min(maximum, value));
}

function unionIntervals(crossings: readonly OrientedCrossing[]): {
	intervals: Float64Array;
	balanced: boolean;
} {
	if (crossings.length === 0) return { intervals: new Float64Array(), balanced: true };

	const sorted = [...crossings].sort((left, right) => left.z - right.z);
	const intervals: number[] = [];
	let winding = 0;
	let intervalStart: number | undefined;
	for (let start = 0; start < sorted.length;) {
		let end = start + 1;
		while (
			end < sorted.length &&
			Math.abs(sorted[end].z - sorted[start].z) <= CROSSING_MERGE_EPSILON_MM
		) {
			end += 1;
		}

		const z = sorted[start].z;
		const wasInside = winding !== 0;
		for (let crossingIndex = start; crossingIndex < end; crossingIndex += 1) {
			winding += sorted[crossingIndex].windingDelta;
		}
		const isInside = winding !== 0;
		if (!wasInside && isInside) intervalStart = z;
		else if (wasInside && !isInside && intervalStart !== undefined) {
			intervals.push(intervalStart, z);
			intervalStart = undefined;
		}
		start = end;
	}

	// An unbalanced ray belongs to an open or inconsistently wound mesh. As
	// before, its final unpaired span is ignored rather than filled to infinity.
	return { intervals: Float64Array.from(intervals), balanced: winding === 0 };
}

/**
 * Rasterizes a transformed triangle mesh into binary layer masks. Pixel values
 * are sampled at pixel centers and are either 0 (empty) or 1 (model).
 *
 * The constructor caches sorted vertical-ray crossings. Individual masks are
 * created lazily so callers can use a rolling layer window instead of retaining
 * the complete stack.
 */
export class ModelLayerMaskRasterizer {
	readonly width: number;
	readonly height: number;
	readonly pixelPitchMm: { x: number; y: number };
	readonly layerHeightMm: number;
	readonly layerCount: number;
	readonly transformedBounds;
	readonly diagnostics: LayerMaskRasterizationDiagnostics;

	readonly #intervalsByPixel: readonly (Float64Array | undefined)[];
	readonly #intersectedPixelIndices: Uint32Array;

	constructor(
		model: Pick<ImportedStlModel, 'positions' | 'bounds'>,
		translation: ModelTranslation = ZERO_MODEL_TRANSLATION,
		rotation: ModelRotation = IDENTITY_MODEL_ROTATION,
		profile: LayerMaskRasterizationProfile = TINYMAKER_LAYER_MASK_PROFILE
	) {
		assertProfile(profile);
		if (model.positions.length === 0 || model.positions.length % 9 !== 0) {
			throw new Error('Model positions must contain complete triangles.');
		}

		this.width = profile.resolution.x;
		this.height = profile.resolution.y;
		this.pixelPitchMm = {
			x: profile.buildAreaMm.x / this.width,
			y: profile.buildAreaMm.y / this.height
		};
		this.layerHeightMm = profile.layerHeightMm;
		this.transformedBounds = transformModelGeometryBounds(model, translation, rotation);
		this.layerCount = Math.max(
			0,
			Math.ceil(this.transformedBounds.max.z / this.layerHeightMm - LAYER_COUNT_EPSILON)
		);

		const rawCrossings: (OrientedCrossing[] | undefined)[] = new Array(this.width * this.height);
		const center = new Vector3(
			(model.bounds.min.x + model.bounds.max.x) / 2,
			(model.bounds.min.y + model.bounds.max.y) / 2,
			(model.bounds.min.z + model.bounds.max.z) / 2
		);
		const quaternion = modelRotationQuaternion(rotation);
		const transformed = new Vector3();
		const vertices: ProjectedVertex[] = new Array(3);
		let projectedTriangleCount = 0;
		let verticalTriangleCount = 0;

		for (let triangleOffset = 0; triangleOffset < model.positions.length; triangleOffset += 9) {
			for (let vertexIndex = 0; vertexIndex < 3; vertexIndex += 1) {
				const offset = triangleOffset + vertexIndex * 3;
				transformed
					.set(
						model.positions[offset] - center.x,
						model.positions[offset + 1] - center.y,
						model.positions[offset + 2] - center.z
					)
					.applyQuaternion(quaternion)
					.add(center);
				vertices[vertexIndex] = {
					x: transformed.x + translation.x,
					y: transformed.y + translation.y,
					z: transformed.z + translation.z
				};
			}

			const a = vertices[0];
			let [b, c] = [vertices[1], vertices[2]];
			let area = edge(a, b, c.x, c.y);
			if (Math.abs(area) <= COORDINATE_EPSILON) {
				verticalTriangleCount += 1;
				continue;
			}
			const windingDelta = Math.sign(area) as -1 | 1;
			if (area < 0) {
				[b, c] = [c, b];
				area = -area;
			}
			projectedTriangleCount += 1;

			const minimumX = Math.min(a.x, b.x, c.x);
			const maximumX = Math.max(a.x, b.x, c.x);
			const minimumY = Math.min(a.y, b.y, c.y);
			const maximumY = Math.max(a.y, b.y, c.y);
			const minimumColumn = clamp(
				Math.ceil(minimumX / this.pixelPitchMm.x - 0.5 - COORDINATE_EPSILON),
				0,
				this.width - 1
			);
			const maximumColumn = clamp(
				Math.floor(maximumX / this.pixelPitchMm.x - 0.5 + COORDINATE_EPSILON),
				0,
				this.width - 1
			);
			const minimumRow = clamp(
				Math.ceil(minimumY / this.pixelPitchMm.y - 0.5 - COORDINATE_EPSILON),
				0,
				this.height - 1
			);
			const maximumRow = clamp(
				Math.floor(maximumY / this.pixelPitchMm.y - 0.5 + COORDINATE_EPSILON),
				0,
				this.height - 1
			);

			if (minimumColumn > maximumColumn || minimumRow > maximumRow) continue;
			const tolerance = Math.max(1, area) * COORDINATE_EPSILON;
			const includeBC = includesEdge(b, c);
			const includeCA = includesEdge(c, a);
			const includeAB = includesEdge(a, b);

			for (let row = minimumRow; row <= maximumRow; row += 1) {
				const y = (row + 0.5) * this.pixelPitchMm.y;
				for (let column = minimumColumn; column <= maximumColumn; column += 1) {
					const x = (column + 0.5) * this.pixelPitchMm.x;
					const weightA = edge(b, c, x, y);
					const weightB = edge(c, a, x, y);
					const weightC = edge(a, b, x, y);
					if (
						!isInsideEdge(weightA, includeBC, tolerance) ||
						!isInsideEdge(weightB, includeCA, tolerance) ||
						!isInsideEdge(weightC, includeAB, tolerance)
					) {
						continue;
					}

					const z = (weightA * a.z + weightB * b.z + weightC * c.z) / area;
					const pixelIndex = row * this.width + column;
					(rawCrossings[pixelIndex] ??= []).push({ z, windingDelta });
				}
			}
		}

		let intersectedPixelCount = 0;
		let oddIntersectionPixelCount = 0;
		const intersectedPixelIndices: number[] = [];
		const intervalsByPixel: (Float64Array | undefined)[] = new Array(rawCrossings.length);
		for (let pixelIndex = 0; pixelIndex < rawCrossings.length; pixelIndex += 1) {
			const crossings = rawCrossings[pixelIndex];
			if (!crossings) continue;
			const { intervals, balanced } = unionIntervals(crossings);
			intervalsByPixel[pixelIndex] = intervals;
			intersectedPixelIndices.push(pixelIndex);
			intersectedPixelCount += 1;
			if (!balanced) oddIntersectionPixelCount += 1;
		}

		this.#intervalsByPixel = intervalsByPixel;
		this.#intersectedPixelIndices = Uint32Array.from(intersectedPixelIndices);
		this.diagnostics = {
			triangleCount: model.positions.length / 9,
			projectedTriangleCount,
			verticalTriangleCount,
			intersectedPixelCount,
			oddIntersectionPixelCount
		};
	}

	layerZMm(layerIndex: number): number {
		this.#assertLayerIndex(layerIndex);
		return (layerIndex + 1) * this.layerHeightMm;
	}

	createLayerMask(layerIndex: number): BinaryLayerMask {
		const z = this.layerZMm(layerIndex);
		const data = new Uint8Array(this.width * this.height);

		for (const pixelIndex of this.#intersectedPixelIndices) {
			const intervals = this.#intervalsByPixel[pixelIndex];
			if (!intervals) continue;
			for (let intervalIndex = 0; intervalIndex + 1 < intervals.length; intervalIndex += 2) {
				if (
					z + CROSSING_MERGE_EPSILON_MM >= intervals[intervalIndex] &&
					z - CROSSING_MERGE_EPSILON_MM <= intervals[intervalIndex + 1]
				) {
					data[pixelIndex] = 1;
					break;
				}
			}
		}

		return { width: this.width, height: this.height, data };
	}

	verticalIntervalsAtPixel(column: number, row: number): readonly VerticalModelInterval[] {
		if (!Number.isInteger(column) || column < 0 || column >= this.width) {
			throw new Error(`column must be an integer from 0 to ${this.width - 1}.`);
		}
		if (!Number.isInteger(row) || row < 0 || row >= this.height) {
			throw new Error(`row must be an integer from 0 to ${this.height - 1}.`);
		}

		const intervalsForPixel = this.#intervalsByPixel[row * this.width + column];
		if (!intervalsForPixel) return [];
		const intervals: VerticalModelInterval[] = [];
		for (let intervalIndex = 0; intervalIndex + 1 < intervalsForPixel.length; intervalIndex += 2) {
			intervals.push({
				minimumZMm: intervalsForPixel[intervalIndex],
				maximumZMm: intervalsForPixel[intervalIndex + 1]
			});
		}
		return intervals;
	}

	*masks(): Generator<BinaryLayerMask, void, undefined> {
		for (let layerIndex = 0; layerIndex < this.layerCount; layerIndex += 1) {
			yield this.createLayerMask(layerIndex);
		}
	}

	#assertLayerIndex(layerIndex: number) {
		if (!Number.isInteger(layerIndex) || layerIndex < 0 || layerIndex >= this.layerCount) {
			throw new Error(`layerIndex must be an integer from 0 to ${this.layerCount - 1}.`);
		}
	}
}

export function createTinyMakerLayerMaskRasterizer(
	model: Pick<ImportedStlModel, 'positions' | 'bounds'>,
	translation: ModelTranslation = ZERO_MODEL_TRANSLATION,
	rotation: ModelRotation = IDENTITY_MODEL_ROTATION
): ModelLayerMaskRasterizer {
	return new ModelLayerMaskRasterizer(model, translation, rotation, TINYMAKER_LAYER_MASK_PROFILE);
}
