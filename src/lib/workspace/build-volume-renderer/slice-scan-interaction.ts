import { Object3D, PerspectiveCamera, Plane, Raycaster, Vector2, Vector3 } from 'three';

/**
 * A vertical plane through `hitPoint`, facing the camera (its normal is horizontal).
 * Ray-casting the pointer against this plane and reading the intersection's Z is
 * the standard technique this codebase already uses for axis-constrained dragging
 * (see the `axis === 'z'` case in `model-interaction.ts`): screen-space pointer
 * movement maps onto real vertical movement regardless of camera angle, without
 * needing to hit-test the dragged object itself on every move.
 */
export function verticalDragPlane(camera: PerspectiveCamera, hitPoint: Vector3): Plane {
	const cameraDirection = camera.position.clone().sub(hitPoint);
	cameraDirection.z = 0;
	if (cameraDirection.lengthSq() === 0) cameraDirection.set(0, 1, 0);
	return new Plane().setFromNormalAndCoplanarPoint(cameraDirection.normalize(), hitPoint);
}

export function clampScanZ(zMm: number, zHeightMm: number): number {
	return Math.min(Math.max(zMm, 0), zHeightMm);
}

type ActiveScanDrag = {
	pointerId: number;
	plane: Plane;
	anchorZ: number;
	initialZMm: number;
	zHeightMm: number;
	onChange: (zMm: number) => void;
};

/** Drags the CAT-scan plane up and down the Z axis by grabbing it directly in the viewport. */
export class SliceScanInteractionController {
	#canvas: HTMLCanvasElement;
	#camera: PerspectiveCamera;
	#raycaster = new Raycaster();
	#pointer = new Vector2();
	#activeDrag: ActiveScanDrag | null = null;

	constructor(canvas: HTMLCanvasElement, camera: PerspectiveCamera) {
		this.#canvas = canvas;
		this.#camera = camera;
	}

	start(
		event: PointerEvent,
		hitTarget: Object3D,
		zMm: number,
		zHeightMm: number,
		onChange: (zMm: number) => void
	): boolean {
		if (event.button !== 0) return false;
		this.#setPointer(event);
		const hit = this.#raycaster.intersectObject(hitTarget, false)[0];
		if (!hit) return false;

		const plane = verticalDragPlane(this.#camera, hit.point);
		const anchor = this.#raycaster.ray.intersectPlane(plane, new Vector3());
		if (!anchor) return false;

		event.preventDefault();
		this.#canvas.setPointerCapture(event.pointerId);
		this.#activeDrag = {
			pointerId: event.pointerId,
			plane,
			anchorZ: anchor.z,
			initialZMm: zMm,
			zHeightMm,
			onChange
		};
		return true;
	}

	update(event: PointerEvent): boolean {
		const drag = this.#activeDrag;
		if (!drag || drag.pointerId !== event.pointerId) return false;

		this.#setPointer(event);
		const point = this.#raycaster.ray.intersectPlane(drag.plane, new Vector3());
		if (!point) return true;

		const deltaZ = point.z - drag.anchorZ;
		drag.onChange(clampScanZ(drag.initialZMm + deltaZ, drag.zHeightMm));
		return true;
	}

	stop(event: PointerEvent): boolean {
		const drag = this.#activeDrag;
		if (!drag || drag.pointerId !== event.pointerId) return false;
		if (this.#canvas.hasPointerCapture(event.pointerId)) {
			this.#canvas.releasePointerCapture(event.pointerId);
		}
		this.#activeDrag = null;
		return true;
	}

	cancel() {
		const drag = this.#activeDrag;
		if (!drag) return;
		if (this.#canvas.hasPointerCapture(drag.pointerId)) {
			this.#canvas.releasePointerCapture(drag.pointerId);
		}
		this.#activeDrag = null;
	}

	#setPointer(event: PointerEvent) {
		const bounds = this.#canvas.getBoundingClientRect();
		this.#pointer.set(
			((event.clientX - bounds.left) / bounds.width) * 2 - 1,
			-((event.clientY - bounds.top) / bounds.height) * 2 + 1
		);
		this.#raycaster.setFromCamera(this.#pointer, this.#camera);
	}
}
