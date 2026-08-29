import { BufferAttribute, BufferGeometry, Mesh, MeshStandardMaterial, Scene } from 'three';

import { createBuildVolumeClippingPlanes } from './build-volume-scene';

export type PreviewMeshData = { positions: Float32Array; normals: Float32Array };

/**
 * Renders the baked "sliced preview" mesh. The geometry is already in
 * build-volume millimetres with `Z = 0` on the plate, so the mesh sits at the
 * scene origin with no transform. Flat shading keeps the faceted, voxel-like read.
 */
export class PreviewRenderer {
	#scene: Scene;
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
		clippingPlanes: createBuildVolumeClippingPlanes('inside')
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
