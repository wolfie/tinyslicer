import {
	BufferGeometry,
	CylinderGeometry,
	Group,
	Mesh,
	MeshStandardMaterial,
	Scene,
	SphereGeometry,
	Vector3
} from 'three';

import type { SupportStructure, SupportStructurePart } from '../supports';

const CYLINDER_AXIS = new Vector3(0, 1, 0);

export class SupportRenderer {
	#scene: Scene;
	#group = new Group();
	#material = new MeshStandardMaterial({
		color: 0x57dc8b,
		emissive: 0x143c24,
		emissiveIntensity: 0.45,
		roughness: 0.48,
		metalness: 0.02
	});
	#geometryCache = new Map<string, BufferGeometry>();
	#structureGroups = new Map<string, Group>();
	#currentStructures: readonly SupportStructure[] = [];

	constructor(scene: Scene) {
		this.#scene = scene;
		scene.add(this.#group);
	}

	setVisible(visible: boolean) {
		this.#group.visible = visible;
	}

	setStructures(structures: readonly SupportStructure[]) {
		if (structures === this.#currentStructures) return;
		this.#currentStructures = structures;
		const currentIds = new Set(structures.map((structure) => structure.id));

		for (const [id, group] of this.#structureGroups) {
			if (currentIds.has(id)) continue;
			this.#group.remove(group);
			this.#structureGroups.delete(id);
		}

		for (const structure of structures) {
			let group = this.#structureGroups.get(structure.id);
			if (!group) {
				group = new Group();
				group.userData.supportStructureId = structure.id;
				this.#structureGroups.set(structure.id, group);
				this.#group.add(group);
			}
			this.#updateStructure(group, structure);
		}
	}

	dispose() {
		this.#scene.remove(this.#group);
		this.#group.clear();
		this.#structureGroups.clear();
		for (const geometry of this.#geometryCache.values()) geometry.dispose();
		this.#geometryCache.clear();
		this.#material.dispose();
	}

	#updateStructure(group: Group, structure: SupportStructure) {
		while (group.children.length > structure.parts.length) {
			group.remove(group.children.at(-1)!);
		}

		for (const [index, structurePart] of structure.parts.entries()) {
			let mesh = group.children[index] as Mesh<BufferGeometry, MeshStandardMaterial> | undefined;
			if (!mesh) {
				mesh = new Mesh(this.#supportGeometry(structurePart), this.#material);
				mesh.renderOrder = 3;
				group.add(mesh);
			} else {
				mesh.geometry = this.#supportGeometry(structurePart);
			}
			mesh.userData.supportStructureId = structure.id;
			mesh.userData.supportPointIds = structure.pointIds;
			mesh.userData.supportPart = structurePart.kind;
			this.#positionPart(mesh, structurePart);
		}
	}

	#supportGeometry(part: SupportStructurePart): BufferGeometry {
		const radialSegments = part.kind === 'foot' ? 32 : 24;
		const key =
			part.kind === 'junction'
				? `sphere:${part.diameter}`
				: `frustum:${part.startDiameter}:${part.endDiameter}:${radialSegments}`;
		let geometry = this.#geometryCache.get(key);
		if (!geometry) {
			geometry =
				part.kind === 'junction'
					? new SphereGeometry(part.diameter / 2, 24, 16)
					: new CylinderGeometry(part.endDiameter / 2, part.startDiameter / 2, 1, radialSegments);
			this.#geometryCache.set(key, geometry);
		}
		return geometry;
	}

	#positionPart(mesh: Mesh<BufferGeometry, MeshStandardMaterial>, part: SupportStructurePart) {
		if (part.kind === 'junction') {
			mesh.position.set(part.center.x, part.center.y, part.center.z);
			mesh.quaternion.identity();
			mesh.scale.set(1, 1, 1);
			return;
		}

		const start = new Vector3(part.start.x, part.start.y, part.start.z);
		const direction = new Vector3(
			part.end.x - part.start.x,
			part.end.y - part.start.y,
			part.end.z - part.start.z
		);
		const length = direction.length();
		mesh.position.copy(start).addScaledVector(direction, 0.5);
		mesh.quaternion.setFromUnitVectors(CYLINDER_AXIS, direction.normalize());
		mesh.scale.set(1, length, 1);
	}
}
