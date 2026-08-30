import {
	BufferAttribute,
	BufferGeometry,
	DoubleSide,
	Group,
	Mesh,
	MeshStandardMaterial,
	Scene
} from 'three';

import { raftMeshData } from '$lib/supports/raft-geometry';
import type { RaftIsland } from '$lib/supports/raft-plan';

export class RaftRenderer {
	#scene: Scene;
	#group = new Group();
	#material = new MeshStandardMaterial({
		color: 0x2f6b52,
		emissive: 0x0c241a,
		emissiveIntensity: 0.35,
		roughness: 0.82,
		metalness: 0.02,
		side: DoubleSide
	});
	#meshes = new Map<string, Mesh<BufferGeometry, MeshStandardMaterial>>();
	#currentIslands: readonly RaftIsland[] = [];

	constructor(scene: Scene) {
		this.#scene = scene;
		scene.add(this.#group);
	}

	setVisible(visible: boolean) {
		this.#group.visible = visible;
	}

	setIslands(islands: readonly RaftIsland[]) {
		if (islands === this.#currentIslands) return;
		this.#currentIslands = islands;
		const currentIds = new Set(islands.map((island) => island.id));

		for (const [id, mesh] of this.#meshes) {
			if (currentIds.has(id)) continue;
			this.#group.remove(mesh);
			mesh.geometry.dispose();
			this.#meshes.delete(id);
		}

		for (const island of islands) {
			const data = raftMeshData(island);
			const geometry = new BufferGeometry();
			geometry.setAttribute('position', new BufferAttribute(data.positions, 3));
			geometry.setAttribute('normal', new BufferAttribute(data.normals, 3));
			geometry.setIndex(new BufferAttribute(data.indices, 1));

			let mesh = this.#meshes.get(island.id);
			if (!mesh) {
				mesh = new Mesh(geometry, this.#material);
				mesh.renderOrder = 2;
				this.#meshes.set(island.id, mesh);
				this.#group.add(mesh);
			} else {
				mesh.geometry.dispose();
				mesh.geometry = geometry;
			}
		}
	}

	dispose() {
		this.#scene.remove(this.#group);
		for (const mesh of this.#meshes.values()) mesh.geometry.dispose();
		this.#meshes.clear();
		this.#group.clear();
		this.#material.dispose();
	}
}
