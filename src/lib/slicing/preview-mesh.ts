import type { ModelRotation, ModelTranslation } from '$lib/workspace/build-volume-renderer/types';
import type { ImportedStlModel } from '$lib/workspace/stl-importer';
import type { SupportPlan } from '$lib/workspace/supports';
import { LayerCoverageRasterizer, type CoverageMask } from './layer-coverage';
import type { LayerMaskRasterizationProfile } from './model-layer-masks';

export const PREVIEW_ISO_LEVEL = 0.5;
export const PREVIEW_PROGRESS_LAYER_STRIDE = 16;

export type PreviewMeshInput = {
	model: Pick<ImportedStlModel, 'positions' | 'bounds'>;
	translation: ModelTranslation;
	rotation: ModelRotation;
	supportPlan: SupportPlan;
};

export type PreviewMeshResult = {
	/** Flat XYZ triangle soup in build-volume millimetres (Z = 0 is the plate). */
	positions: Float32Array;
	/** Flat per-vertex flat-shaded normals, parallel to {@link positions}. */
	normals: Float32Array;
	triangleCount: number;
	layerCount: number;
	zHeightMm: number;
	meshIsWatertightAtPixelSamples: boolean;
};

export type PreviewMeshProgress = (completedLayers: number, totalLayers: number) => void;

export type PreviewMeshOptions = {
	profile?: LayerMaskRasterizationProfile;
	supersample?: number;
};

/**
 * Reconstructs the printed result as a single watertight mesh from the same
 * coverage masks the exporter will emit. Each pixel of every 0.05 mm layer whose
 * combined model + support coverage crosses 50% becomes one voxel; the exposed
 * faces of that voxel field are greedy-meshed into rectangles. Model and supports
 * are already unioned in the coverage field, so they fuse without a 3D boolean,
 * and the result is a true voxel view at the printer's own resolution.
 */
export function buildPreviewMesh(
	input: PreviewMeshInput,
	onProgress?: PreviewMeshProgress,
	options: PreviewMeshOptions = {}
): PreviewMeshResult {
	const rasterizer = new LayerCoverageRasterizer(
		input.model,
		input.translation,
		input.rotation,
		input.supportPlan,
		options.profile,
		options.supersample
	);
	const { layerCount, layerHeightMm, width, height } = rasterizer;
	const pitchX = rasterizer.pixelPitchMm.x;
	const pitchY = rasterizer.pixelPitchMm.y;

	if (layerCount === 0) {
		onProgress?.(0, 0);
		return {
			positions: new Float32Array(),
			normals: new Float32Array(),
			triangleCount: 0,
			layerCount: 0,
			zHeightMm: 0,
			meshIsWatertightAtPixelSamples: rasterizer.diagnostics.meshIsWatertightAtPixelSamples
		};
	}

	const positions: number[] = [];
	const normals: number[] = [];

	const pushQuad = (
		v0: readonly [number, number, number],
		v1: readonly [number, number, number],
		v2: readonly [number, number, number],
		v3: readonly [number, number, number],
		nx: number,
		ny: number,
		nz: number
	) => {
		positions.push(...v0, ...v1, ...v2, ...v0, ...v2, ...v3);
		for (let i = 0; i < 6; i += 1) normals.push(nx, ny, nz);
	};

	const occupancy = (mask: CoverageMask): Uint8Array => {
		const out = new Uint8Array(mask.data.length);
		for (let i = 0; i < out.length; i += 1) out[i] = mask.data[i] >= PREVIEW_ISO_LEVEL ? 1 : 0;
		return out;
	};

	// Every pixel where exactly one of the two stacked layers is solid gets a
	// horizontal face at `zMm`, pointing away from the solid side.
	const emitHorizontalFaces = (above: Uint8Array | null, below: Uint8Array | null, zMm: number) => {
		const up = new Uint8Array(width * height); // solid below, empty above
		const down = new Uint8Array(width * height); // solid above, empty below
		for (let i = 0; i < up.length; i += 1) {
			const a = above ? above[i] : 0;
			const b = below ? below[i] : 0;
			if (b && !a) up[i] = 1;
			else if (a && !b) down[i] = 1;
		}
		for (const [x0, y0, x1, y1] of greedyRectangles(up, width, height)) {
			const ax = x0 * pitchX;
			const bx = (x1 + 1) * pitchX;
			const ay = y0 * pitchY;
			const by = (y1 + 1) * pitchY;
			pushQuad([ax, ay, zMm], [bx, ay, zMm], [bx, by, zMm], [ax, by, zMm], 0, 0, 1);
		}
		for (const [x0, y0, x1, y1] of greedyRectangles(down, width, height)) {
			const ax = x0 * pitchX;
			const bx = (x1 + 1) * pitchX;
			const ay = y0 * pitchY;
			const by = (y1 + 1) * pitchY;
			pushQuad([ax, ay, zMm], [ax, by, zMm], [bx, by, zMm], [bx, ay, zMm], 0, 0, -1);
		}
	};

	// Vertical walls of one slab: a face wherever a solid pixel borders empty
	// space (or the grid edge). Collinear faces are merged into runs.
	const emitWalls = (occ: Uint8Array, zBottom: number, zTop: number) => {
		const solid = (x: number, y: number) =>
			x >= 0 && y >= 0 && x < width && y < height && occ[y * width + x];

		// +X / -X faces: merge along Y within a column.
		for (let x = 0; x < width; x += 1) {
			for (const sign of [1, -1] as const) {
				const planeX = (sign === 1 ? x + 1 : x) * pitchX;
				let runStart = -1;
				for (let y = 0; y <= height; y += 1) {
					const face = y < height && solid(x, y) && !solid(x + sign, y);
					if (face && runStart === -1) runStart = y;
					if (!face && runStart !== -1) {
						const ay = runStart * pitchY;
						const by = y * pitchY;
						if (sign === 1) {
							pushQuad(
								[planeX, ay, zBottom],
								[planeX, by, zBottom],
								[planeX, by, zTop],
								[planeX, ay, zTop],
								1,
								0,
								0
							);
						} else {
							pushQuad(
								[planeX, ay, zBottom],
								[planeX, ay, zTop],
								[planeX, by, zTop],
								[planeX, by, zBottom],
								-1,
								0,
								0
							);
						}
						runStart = -1;
					}
				}
			}
		}

		// +Y / -Y faces: merge along X within a row.
		for (let y = 0; y < height; y += 1) {
			for (const sign of [1, -1] as const) {
				const planeY = (sign === 1 ? y + 1 : y) * pitchY;
				let runStart = -1;
				for (let x = 0; x <= width; x += 1) {
					const face = x < width && solid(x, y) && !solid(x, y + sign);
					if (face && runStart === -1) runStart = x;
					if (!face && runStart !== -1) {
						const ax = runStart * pitchX;
						const bx = x * pitchX;
						if (sign === 1) {
							pushQuad(
								[ax, planeY, zBottom],
								[ax, planeY, zTop],
								[bx, planeY, zTop],
								[bx, planeY, zBottom],
								0,
								1,
								0
							);
						} else {
							pushQuad(
								[ax, planeY, zBottom],
								[bx, planeY, zBottom],
								[bx, planeY, zTop],
								[ax, planeY, zTop],
								0,
								-1,
								0
							);
						}
						runStart = -1;
					}
				}
			}
		}
	};

	let previousOccupancy: Uint8Array | null = null;
	for (let layerIndex = 0; layerIndex < layerCount; layerIndex += 1) {
		const occ = occupancy(rasterizer.coverageMask(layerIndex));
		emitHorizontalFaces(occ, previousOccupancy, layerIndex * layerHeightMm);
		emitWalls(occ, layerIndex * layerHeightMm, (layerIndex + 1) * layerHeightMm);
		previousOccupancy = occ;
		if (layerIndex % PREVIEW_PROGRESS_LAYER_STRIDE === 0) onProgress?.(layerIndex, layerCount);
	}
	emitHorizontalFaces(null, previousOccupancy, layerCount * layerHeightMm);
	onProgress?.(layerCount, layerCount);

	return {
		positions: Float32Array.from(positions),
		normals: Float32Array.from(normals),
		triangleCount: positions.length / 9,
		layerCount,
		zHeightMm: layerCount * layerHeightMm,
		meshIsWatertightAtPixelSamples: rasterizer.diagnostics.meshIsWatertightAtPixelSamples
	};
}

/**
 * Greedy meshing: covers every set pixel of `mask` with as few axis-aligned
 * rectangles as possible. Returns inclusive pixel ranges `[x0, y0, x1, y1]`.
 */
function greedyRectangles(
	mask: Uint8Array,
	width: number,
	height: number
): Array<[number, number, number, number]> {
	const used = new Uint8Array(mask.length);
	const rectangles: Array<[number, number, number, number]> = [];
	for (let y = 0; y < height; y += 1) {
		for (let x = 0; x < width; x += 1) {
			const start = y * width + x;
			if (!mask[start] || used[start]) continue;

			let x1 = x;
			while (x1 + 1 < width && mask[y * width + x1 + 1] && !used[y * width + x1 + 1]) x1 += 1;

			let y1 = y;
			grow: while (y1 + 1 < height) {
				for (let cx = x; cx <= x1; cx += 1) {
					const index = (y1 + 1) * width + cx;
					if (!mask[index] || used[index]) break grow;
				}
				y1 += 1;
			}

			for (let cy = y; cy <= y1; cy += 1) {
				for (let cx = x; cx <= x1; cx += 1) used[cy * width + cx] = 1;
			}
			rectangles.push([x, y, x1, y1]);
		}
	}
	return rectangles;
}
