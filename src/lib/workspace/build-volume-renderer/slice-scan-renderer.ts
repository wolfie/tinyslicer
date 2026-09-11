import {
	DataTexture,
	DoubleSide,
	Mesh,
	MeshBasicMaterial,
	NearestFilter,
	PlaneGeometry,
	RGBAFormat,
	Scene,
	SRGBColorSpace,
	UnsignedByteType
} from 'three';

import { TINYMAKER_PROFILE } from '$lib/printer/tinymaker';

const BUILD_VOLUME = TINYMAKER_PROFILE.buildVolume;

/** Opacity floor for a pure-black (uncovered) pixel; opacity ramps linearly up to
 *  1 at pure white, so empty background fades while the model's mask stays solid. */
const MIN_OPACITY_AT_BLACK = 0.5;

export type ScanLayerImage = { width: number; height: number; pixels: Uint8Array };

/**
 * Renders the "CAT-scan" cross-section: a build-plate-sized quad textured with the
 * exact grayscale layer image the exporter would PNG-encode for the current layer,
 * positioned at that layer's Z. `NearestFilter` (no mip/bilinear blending) and
 * tagging the texture `SRGBColorSpace` keep every rendered texel's *color* equal to
 * its raw source byte after the renderer's own sRGB output encode, so the plane
 * reproduces the exported PNG pixel-for-pixel rather than an interpolated
 * approximation of it — alpha is a separate, purely cosmetic channel layered on top
 * (see `MIN_OPACITY_AT_BLACK`) and never touches that color guarantee.
 * Geometry mirrors `createPlate()`: the untransformed `PlaneGeometry` already lies
 * flat in X/Y, so centering it over the build volume needs no rotation.
 */
export class SliceScanRenderer {
	#scene: Scene;
	#geometry = new PlaneGeometry(BUILD_VOLUME.x, BUILD_VOLUME.y);
	#material = new MeshBasicMaterial({
		side: DoubleSide,
		toneMapped: false,
		transparent: true,
		depthWrite: false,
		// Wins the z-fight against the preview mesh's own coincident top cap (which
		// nudges toward the camera by 1 unit for the same reason against the plate).
		polygonOffset: true,
		polygonOffsetFactor: -2,
		polygonOffsetUnits: -2
	});
	#mesh: Mesh;
	#texture: DataTexture | null = null;
	#rgba: Uint8Array | null = null;
	#imageWidth = 0;
	#imageHeight = 0;

	constructor(scene: Scene) {
		this.#scene = scene;
		this.#mesh = new Mesh(this.#geometry, this.#material);
		this.#mesh.visible = false;
		this.#mesh.renderOrder = 2;
		this.#scene.add(this.#mesh);
	}

	get mesh(): Mesh {
		return this.#mesh;
	}

	setImage(image: ScanLayerImage | null) {
		if (!image) {
			this.#mesh.visible = false;
			return;
		}

		this.#ensureTexture(image.width, image.height);
		const rgba = this.#rgba!;
		for (let i = 0; i < image.pixels.length; i += 1) {
			const value = image.pixels[i];
			const offset = i * 4;
			rgba[offset] = value;
			rgba[offset + 1] = value;
			rgba[offset + 2] = value;
			rgba[offset + 3] = Math.round(
				255 * (MIN_OPACITY_AT_BLACK + (value / 255) * (1 - MIN_OPACITY_AT_BLACK))
			);
		}
		this.#texture!.needsUpdate = true;
		this.#mesh.visible = true;
	}

	setZ(zMm: number) {
		this.#mesh.position.set(BUILD_VOLUME.x / 2, BUILD_VOLUME.y / 2, zMm);
	}

	dispose() {
		this.#scene.remove(this.#mesh);
		this.#geometry.dispose();
		this.#material.dispose();
		this.#texture?.dispose();
	}

	#ensureTexture(width: number, height: number) {
		if (this.#texture && this.#imageWidth === width && this.#imageHeight === height) return;
		this.#texture?.dispose();
		this.#imageWidth = width;
		this.#imageHeight = height;
		this.#rgba = new Uint8Array(width * height * 4);
		this.#texture = new DataTexture(this.#rgba, width, height, RGBAFormat, UnsignedByteType);
		this.#texture.colorSpace = SRGBColorSpace;
		this.#texture.magFilter = NearestFilter;
		this.#texture.minFilter = NearestFilter;
		this.#texture.generateMipmaps = false;
		this.#material.map = this.#texture;
	}
}
