import {
	CircleGeometry,
	DoubleSide,
	Group,
	Mesh,
	MeshBasicMaterial,
	Object3D,
	Scene,
	Vector3
} from 'three';

import type { SupportPoint } from '../supports';

/** Radius of the flat disc drawn on the model surface at each support contact. */
export const SUPPORT_MARKER_RADIUS_MM = 1;
/** Lift the disc off the surface a touch so it never z-fights with the model. */
export const SUPPORT_MARKER_SURFACE_OFFSET_MM = 0.05;

const DISC_NORMAL = new Vector3(0, 0, 1);
const FALLBACK_NORMAL = new Vector3(0, 0, 1);

/**
 * Renders one flat red disc per support point, laid against the model surface
 * (oriented to the point normal). Each disc is an individually raycastable
 * `Mesh` tagged with `userData.supportPointId`, so pointer code can pick,
 * drag, or delete a single support later. World-space like {@link SupportRenderer}
 * — the model transform is locked while supports are being edited.
 */
export class SupportMarkerRenderer {
	#scene: Scene;
	#group = new Group();
	#geometry = new CircleGeometry(SUPPORT_MARKER_RADIUS_MM, 40);
	#material = new MeshBasicMaterial({
		color: 0xff433a,
		side: DoubleSide,
		transparent: true,
		opacity: 0.9,
		depthWrite: false,
		polygonOffset: true,
		polygonOffsetFactor: -4,
		polygonOffsetUnits: -4
	});
	#markers = new Map<string, Mesh>();
	#currentPoints: readonly SupportPoint[] = [];

	constructor(scene: Scene) {
		this.#scene = scene;
		this.#group.renderOrder = 4;
		scene.add(this.#group);
	}

	/** Raycast against these to hit-test individual support markers. */
	get pickTargets(): readonly Object3D[] {
		return this.#group.children;
	}

	setVisible(visible: boolean) {
		this.#group.visible = visible;
	}

	setPoints(points: readonly SupportPoint[]) {
		if (points === this.#currentPoints) return;
		this.#currentPoints = points;

		const liveIds = new Set(points.map((point) => point.id));
		for (const [id, mesh] of this.#markers) {
			if (liveIds.has(id)) continue;
			this.#group.remove(mesh);
			this.#markers.delete(id);
		}

		for (const point of points) {
			let mesh = this.#markers.get(point.id);
			if (!mesh) {
				mesh = new Mesh(this.#geometry, this.#material);
				mesh.renderOrder = 4;
				mesh.userData.supportPointId = point.id;
				this.#markers.set(point.id, mesh);
				this.#group.add(mesh);
			}
			this.#placeMarker(mesh, point);
		}
	}

	dispose() {
		this.#scene.remove(this.#group);
		this.#group.clear();
		this.#markers.clear();
		this.#geometry.dispose();
		this.#material.dispose();
	}

	#placeMarker(mesh: Mesh, point: SupportPoint) {
		const normal = new Vector3(point.normal.x, point.normal.y, point.normal.z);
		if (normal.lengthSq() < 1e-12) {
			normal.copy(FALLBACK_NORMAL);
		} else {
			normal.normalize();
		}
		mesh.quaternion.setFromUnitVectors(DISC_NORMAL, normal);
		mesh.position
			.set(point.position.x, point.position.y, point.position.z)
			.addScaledVector(normal, SUPPORT_MARKER_SURFACE_OFFSET_MM);
	}
}
