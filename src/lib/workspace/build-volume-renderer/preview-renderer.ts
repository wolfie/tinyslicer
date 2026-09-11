import {
	BufferAttribute,
	BufferGeometry,
	Mesh,
	MeshStandardMaterial,
	Plane,
	Scene,
	Vector3
} from 'three';

import { createBuildVolumeClippingPlanes } from './build-volume-scene';

export type PreviewMeshData = { positions: Float32Array; normals: Float32Array };

/**
 * Renders the baked "sliced preview" mesh. The geometry is already in
 * build-volume millimetres with `Z = 0` on the plate, so the mesh sits at the
 * scene origin with no transform. Flat shading keeps the faceted, voxel-like read.
 */
export class PreviewRenderer {
	#scene: Scene;
	// A 7th clipping plane for the CAT-scan cross-section: mutated in place (rather
	// than rebuilding the `clippingPlanes` array) so toggling scan mode is cheap.
	// At its default `+Infinity` constant it never clips anything (see `setScanClip`).
	#scanClipPlane = new Plane(new Vector3(0, 0, -1), Number.POSITIVE_INFINITY);
	#material = new MeshStandardMaterial({
		color: 0xd8d2c6,
		roughness: 0.85,
		metalness: 0,
		flatShading: true,
		// The reconstructed base caps sit a hair above the translucent build plate;
		// nudge the preview forward so those large coplanar faces do not z-fight it.
		polygonOffset: true,
		polygonOffsetFactor: -1,
		polygonOffsetUnits: -1,
		clippingPlanes: [...createBuildVolumeClippingPlanes('inside'), this.#scanClipPlane]
	});
	#mesh: Mesh | null = null;
	#current: PreviewMeshData | null = null;

	constructor(scene: Scene) {
		this.#scene = scene;
	}

	setMesh(data: PreviewMeshData | null) {
		if (data === this.#current) return;
		this.#current = data;
		this.#removeMesh();
		if (!data) return;

		const geometry = new BufferGeometry();
		geometry.setAttribute('position', new BufferAttribute(data.positions, 3));
		geometry.setAttribute('normal', new BufferAttribute(data.normals, 3));
		geometry.computeBoundingSphere();

		this.#mesh = new Mesh(geometry, this.#material);
		this.#mesh.renderOrder = 1;
		this.#scene.add(this.#mesh);
	}

	setVisible(visible: boolean) {
		if (this.#mesh) this.#mesh.visible = visible;
	}

	/** Discards everything above `zMm` (the CAT-scan cut); `null` clips nothing. */
	setScanClip(zMm: number | null) {
		this.#scanClipPlane.constant = zMm ?? Number.POSITIVE_INFINITY;
	}

	dispose() {
		this.#removeMesh();
		this.#material.dispose();
	}

	#removeMesh() {
		if (!this.#mesh) return;
		this.#scene.remove(this.#mesh);
		this.#mesh.geometry.dispose();
		this.#mesh = null;
	}
}
