import { raftCrossSectionAtZ, type RaftIsland } from '$lib/supports/raft-plan';
import {
	DEFAULT_MODEL_SCALE,
	IDENTITY_MODEL_ROTATION,
	ZERO_MODEL_TRANSLATION
} from '$lib/workspace/build-volume-renderer/model-transform';
import type {
	ModelRotation,
	ModelScale,
	ModelTranslation
} from '$lib/workspace/build-volume-renderer/types';
import type { ImportedStlModel } from '$lib/workspace/stl-importer';
import type { SupportPlan } from '$lib/workspace/supports';
import {
	ModelLayerMaskRasterizer,
	TINYMAKER_LAYER_MASK_PROFILE,
	type LayerMaskRasterizationProfile
} from './model-layer-masks';
import { supportPlanCirclesAtZ } from './support-cross-sections';

/**
 * Internal supersampling factor. The binary model mask and the support discs are
 * rasterized at `PREVIEW_SUPERSAMPLE` times the printer resolution and then box
 * downsampled, giving `PREVIEW_SUPERSAMPLE^2 + 1` coverage levels per pixel. This
 * is the deterministic supersample/downsample anti-aliasing the spec (section
 * 8.3) calls for. The preview build retains the resulting printer pixels so PNG
 * export can reuse them without rasterizing the scene again.
 */
export const PREVIEW_SUPERSAMPLE = 4;

export type CoverageMask = {
	width: number;
	height: number;
	/** Coverage per pixel in `[0, 1]`. */
	data: Float32Array;
};

const EMPTY_SUPPORT_PLAN: SupportPlan = { structures: [], unresolvedPoints: [] };

/**
 * Produces the combined model + support coverage mask for any layer, at printer
 * resolution. Wraps a single supersampled {@link ModelLayerMaskRasterizer}; layer
 * enumeration is identical to it (layer count depends only on scene height).
 */
export class LayerCoverageRasterizer {
	readonly width: number;
	readonly height: number;
	readonly supersample: number;
	readonly pixelPitchMm: { x: number; y: number };
	readonly layerHeightMm: number;
	readonly layerCount: number;
	readonly transformedBounds: ModelLayerMaskRasterizer['transformedBounds'];
	readonly diagnostics: {
		meshIsWatertightAtPixelSamples: boolean;
		oddIntersectionPixelCount: number;
	};

	readonly #inner: ModelLayerMaskRasterizer;
	readonly #plan: SupportPlan;
	readonly #raftIslands: readonly RaftIsland[];

	constructor(
		model: Pick<ImportedStlModel, 'positions' | 'bounds'>,
		translation: ModelTranslation = ZERO_MODEL_TRANSLATION,
		rotation: ModelRotation = IDENTITY_MODEL_ROTATION,
		supportPlan: SupportPlan = EMPTY_SUPPORT_PLAN,
		raftIslands: readonly RaftIsland[] = [],
		profile: LayerMaskRasterizationProfile = TINYMAKER_LAYER_MASK_PROFILE,
		supersample: number = PREVIEW_SUPERSAMPLE,
		scale: ModelScale = DEFAULT_MODEL_SCALE
	) {
		if (!Number.isInteger(supersample) || supersample < 1) {
			throw new Error('supersample must be a positive integer.');
		}
		this.supersample = supersample;
		this.width = profile.resolution.x;
		this.height = profile.resolution.y;
		this.#plan = supportPlan;
		this.#raftIslands = raftIslands;
		this.#inner = new ModelLayerMaskRasterizer(
			model,
			translation,
			rotation,
			{
				resolution: {
					x: profile.resolution.x * supersample,
					y: profile.resolution.y * supersample
				},
				buildAreaMm: profile.buildAreaMm,
				layerHeightMm: profile.layerHeightMm
			},
			scale
		);
		this.pixelPitchMm = {
			x: profile.buildAreaMm.x / this.width,
			y: profile.buildAreaMm.y / this.height
		};
		this.layerHeightMm = this.#inner.layerHeightMm;
		this.layerCount = this.#inner.layerCount;
		this.transformedBounds = this.#inner.transformedBounds;
		this.diagnostics = {
			meshIsWatertightAtPixelSamples: this.#inner.diagnostics.oddIntersectionPixelCount === 0,
			oddIntersectionPixelCount: this.#inner.diagnostics.oddIntersectionPixelCount
		};
	}

	layerZMm(layerIndex: number): number {
		return this.#inner.layerZMm(layerIndex);
	}

	coverageMask(layerIndex: number): CoverageMask {
		const s = this.supersample;
		const superWidth = this.#inner.width;
		const superHeight = this.#inner.height;
		const superData = this.#inner.createLayerMask(layerIndex).data;

		const zMm = this.layerZMm(layerIndex);
		this.#stampSupportCircles(superData, superWidth, superHeight, zMm);
		this.#stampRaftPolygons(superData, superWidth, superHeight, zMm);

		const out = new Float32Array(this.width * this.height);
		const inverseCells = 1 / (s * s);
		for (let ny = 0; ny < this.height; ny += 1) {
			const baseRow = ny * s;
			for (let nx = 0; nx < this.width; nx += 1) {
				const baseColumn = nx * s;
				let sum = 0;
				for (let sy = 0; sy < s; sy += 1) {
					const rowOffset = (baseRow + sy) * superWidth + baseColumn;
					for (let sx = 0; sx < s; sx += 1) sum += superData[rowOffset + sx];
				}
				out[ny * this.width + nx] = sum * inverseCells;
			}
		}
		return { width: this.width, height: this.height, data: out };
	}

	#stampSupportCircles(
		superData: Uint8Array,
		superWidth: number,
		superHeight: number,
		zMm: number
	) {
		const circles = supportPlanCirclesAtZ(this.#plan, zMm);
		if (circles.length === 0) return;
		const subPitchX = this.pixelPitchMm.x / this.supersample;
		const subPitchY = this.pixelPitchMm.y / this.supersample;

		for (const circle of circles) {
			const minColumn = Math.max(0, Math.floor((circle.xMm - circle.radiusMm) / subPitchX - 0.5));
			const maxColumn = Math.min(
				superWidth - 1,
				Math.ceil((circle.xMm + circle.radiusMm) / subPitchX - 0.5)
			);
			const minRow = Math.max(0, Math.floor((circle.yMm - circle.radiusMm) / subPitchY - 0.5));
			const maxRow = Math.min(
				superHeight - 1,
				Math.ceil((circle.yMm + circle.radiusMm) / subPitchY - 0.5)
			);
			const radiusSquared = circle.radiusMm * circle.radiusMm;

			for (let row = minRow; row <= maxRow; row += 1) {
				const dy = (row + 0.5) * subPitchY - circle.yMm;
				const rowOffset = row * superWidth;
				for (let column = minColumn; column <= maxColumn; column += 1) {
					const dx = (column + 0.5) * subPitchX - circle.xMm;
					if (dx * dx + dy * dy <= radiusSquared) superData[rowOffset + column] = 1;
				}
			}
		}
	}

	/**
	 * Fills each raft island's cross-section at `zMm` into the supersampled mask,
	 * so the preview and the export slice the raft exactly as they slice the model
	 * and the posts. The cross-section is a ring set (outer boundary, then the
	 * rim's hole once the core is gone), filled with even-odd parity.
	 */
	#stampRaftPolygons(superData: Uint8Array, superWidth: number, superHeight: number, zMm: number) {
		if (this.#raftIslands.length === 0) return;
		const subPitchX = this.pixelPitchMm.x / this.supersample;
		const subPitchY = this.pixelPitchMm.y / this.supersample;

		for (const island of this.#raftIslands) {
			const rings = raftCrossSectionAtZ(island, zMm);
			const outer = rings[0];
			if (!outer || outer.length < 3) continue;

			let minX = Infinity;
			let minY = Infinity;
			let maxX = -Infinity;
			let maxY = -Infinity;
			for (const point of outer) {
				if (point.x < minX) minX = point.x;
				if (point.x > maxX) maxX = point.x;
				if (point.y < minY) minY = point.y;
				if (point.y > maxY) maxY = point.y;
			}

			const minColumn = Math.max(0, Math.floor(minX / subPitchX - 0.5));
			const maxColumn = Math.min(superWidth - 1, Math.ceil(maxX / subPitchX - 0.5));
			const minRow = Math.max(0, Math.floor(minY / subPitchY - 0.5));
			const maxRow = Math.min(superHeight - 1, Math.ceil(maxY / subPitchY - 0.5));

			for (let row = minRow; row <= maxRow; row += 1) {
				const sampleY = (row + 0.5) * subPitchY;
				const rowOffset = row * superWidth;
				for (let column = minColumn; column <= maxColumn; column += 1) {
					const sampleX = (column + 0.5) * subPitchX;
					if (pointInRings(sampleX, sampleY, rings)) superData[rowOffset + column] = 1;
				}
			}
		}
	}
}

/** Even-odd parity across every ring, at a pixel centre — same sampling as the circle stamp. */
function pointInRings(x: number, y: number, rings: readonly { x: number; y: number }[][]): boolean {
	let inside = false;
	for (const ring of rings) {
		for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
			const a = ring[i];
			const b = ring[j];
			if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) {
				inside = !inside;
			}
		}
	}
	return inside;
}
