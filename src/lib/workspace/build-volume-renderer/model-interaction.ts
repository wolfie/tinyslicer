import { PerspectiveCamera, Plane, Quaternion, Raycaster, Vector2, Vector3 } from 'three';

import type { ModelSurfaceHit } from '../supports';
import {
	clampModelScale,
	modelRotationQuaternion,
	nudgeModelTranslation,
	signedRotationAngle,
	snapRotationAngle
} from './model-transform';
import { pickSupportSurface } from './support-picking';
import type { RenderedModel } from './rendered-model';
import type { SupportMarkerRenderer } from './support-marker-renderer';
import type { RotationAxis, TransformGizmo, TranslationDirection } from './transform-gizmo';
import type {
	BuildVolumeInteractionMode,
	ModelInteraction,
	ModelRotation,
	ModelScale,
	ModelTranslation
} from './types';

type ActiveTranslationDrag = {
	kind: 'translation';
	pointerId: number;
	axis: 'xy' | 'z';
	plane: Plane;
	anchor: Vector3;
	initialTranslation: ModelTranslation;
	onChange: (translation: ModelTranslation) => void;
	onInteractionChange: (interaction: ModelInteraction | null) => void;
};

type ActiveRotationDrag = {
	kind: 'rotation';
	pointerId: number;
	axis: RotationAxis;
	plane: Plane;
	center: Vector3;
	previousRadial: Vector3;
	accumulatedAngle: number;
	initialRotation: Quaternion;
	onChange: (rotation: ModelRotation) => void;
	onInteractionChange: (interaction: ModelInteraction | null) => void;
};

type ActiveScaleDrag = {
	kind: 'scale';
	pointerId: number;
	handleIndex: number;
	anchor: Vector3;
	handleVector: Vector3;
	initialScale: ModelScale;
	initialLineParameter: number;
	onChange: (scale: ModelScale) => void;
	onInteractionChange: (interaction: ModelInteraction | null) => void;
};

type ActiveModelDrag = ActiveTranslationDrag | ActiveRotationDrag | ActiveScaleDrag;

export function scaleAlongRay(
	rayOrigin: Vector3,
	rayDirection: Vector3,
	anchor: Vector3,
	handleVector: Vector3,
	initialScale: ModelScale,
	initialLineParameter = 1
): ModelScale {
	const parameter = lineParameterAlongRay(rayOrigin, rayDirection, anchor, handleVector);
	return clampModelScale(initialScale * (parameter / initialLineParameter));
}

function lineParameterAlongRay(
	rayOrigin: Vector3,
	rayDirection: Vector3,
	anchor: Vector3,
	handleVector: Vector3
): number {
	const offset = rayOrigin.clone().sub(anchor);
	const rayDotHandle = rayDirection.dot(handleVector);
	const handleLengthSquared = handleVector.lengthSq();
	const denominator = handleLengthSquared - rayDotHandle * rayDotHandle;
	if (denominator <= 1e-10) return 1;
	return (handleVector.dot(offset) - rayDotHandle * rayDirection.dot(offset)) / denominator;
}

export class ModelInteractionController {
	#canvas: HTMLCanvasElement;
	#camera: PerspectiveCamera;
	#model: RenderedModel;
	#gizmo: TransformGizmo;
	#supportMarkers: SupportMarkerRenderer;
	#raycaster = new Raycaster();
	#pointer = new Vector2();
	#interactionMode: BuildVolumeInteractionMode = 'readonly';
	#activeDrag: ActiveModelDrag | null = null;

	constructor(
		canvas: HTMLCanvasElement,
		camera: PerspectiveCamera,
		model: RenderedModel,
		gizmo: TransformGizmo,
		supportMarkers: SupportMarkerRenderer
	) {
		this.#canvas = canvas;
		this.#camera = camera;
		this.#model = model;
		this.#gizmo = gizmo;
		this.#supportMarkers = supportMarkers;
	}

	get activeRotationAxis(): keyof ModelTranslation | null {
		return this.#activeDrag?.kind === 'rotation' ? this.#activeDrag.axis.axis : null;
	}

	get activeScaleHandle(): number | null {
		return this.#activeDrag?.kind === 'scale' ? this.#activeDrag.handleIndex : null;
	}

	setInteractionMode(mode: BuildVolumeInteractionMode) {
		if (mode === this.#interactionMode) return;
		this.#interactionMode = mode;
		if (mode !== 'transform-model') this.cancel();
	}

	startModelInteraction(
		event: PointerEvent,
		translation: ModelTranslation,
		rotation: ModelRotation,
		scale: ModelScale,
		onTranslationChange: (translation: ModelTranslation) => void,
		onRotationChange: (rotation: ModelRotation) => void,
		onScaleChange: (scale: ModelScale) => void,
		onInteractionChange: (interaction: ModelInteraction | null) => void
	): boolean {
		const modelMesh = this.#model.mesh;
		if (this.#interactionMode !== 'transform-model' || event.button !== 0 || !modelMesh) {
			return false;
		}
		this.#setPointer(event);
		const scaleHit = this.#raycaster.intersectObjects(this.#gizmo.scaleHitTargets, false)[0];
		if (scaleHit) {
			event.preventDefault();
			this.#canvas.setPointerCapture(event.pointerId);
			const handleIndex = scaleHit.object.userData.scaleHandleIndex as number;
			const anchor = this.#gizmo.scaleAnchor.clone();
			const handleVector = scaleHit.object.position.clone().sub(anchor);
			this.#activeDrag = {
				kind: 'scale',
				pointerId: event.pointerId,
				handleIndex,
				anchor,
				handleVector,
				initialScale: scale,
				initialLineParameter: Math.max(
					0.01,
					lineParameterAlongRay(
						this.#raycaster.ray.origin,
						this.#raycaster.ray.direction,
						anchor,
						handleVector
					)
				),
				onChange: onScaleChange,
				onInteractionChange
			};
			onInteractionChange({ kind: 'scale' });
			return true;
		}

		const ringHit = this.#raycaster.intersectObjects(this.#gizmo.rotationHitTargets, false)[0];
		if (ringHit) {
			const axis = ringHit.object.userData.axis as RotationAxis;
			return this.#startRotationDrag(
				event,
				ringHit.point,
				axis,
				rotation,
				onRotationChange,
				onInteractionChange
			);
		}

		const arrowHit = this.#raycaster.intersectObjects(
			this.#gizmo.visibleTranslationHitTargets(),
			false
		)[0];
		if (arrowHit) {
			event.preventDefault();
			const { axis, sign } = arrowHit.object.userData.direction as TranslationDirection;
			onTranslationChange(nudgeModelTranslation(translation, axis, sign, event.shiftKey));
			return true;
		}

		const modelHit = this.#raycaster.intersectObject(modelMesh, false)[0];
		if (!modelHit) return false;

		const axis = event.shiftKey ? 'z' : 'xy';
		const plane = new Plane();
		if (axis === 'xy') {
			plane.setFromNormalAndCoplanarPoint(new Vector3(0, 0, 1), modelHit.point);
		} else {
			const cameraDirection = this.#camera.position.clone().sub(modelHit.point);
			cameraDirection.z = 0;
			if (cameraDirection.lengthSq() === 0) cameraDirection.set(0, 1, 0);
			plane.setFromNormalAndCoplanarPoint(cameraDirection.normalize(), modelHit.point);
		}

		const anchor = this.#raycaster.ray.intersectPlane(plane, new Vector3());
		if (!anchor) return false;

		event.preventDefault();
		this.#canvas.setPointerCapture(event.pointerId);
		this.#activeDrag = {
			kind: 'translation',
			pointerId: event.pointerId,
			axis,
			plane,
			anchor,
			initialTranslation: { ...translation },
			onChange: onTranslationChange,
			onInteractionChange
		};
		onInteractionChange({ kind: 'translation' });
		return true;
	}

	pickModelSurface(event: PointerEvent): ModelSurfaceHit | null {
		const modelMesh = this.#model.mesh;
		if (this.#interactionMode !== 'place-supports' || event.button !== 0 || !modelMesh) {
			return null;
		}

		this.#setPointer(event);
		return pickSupportSurface(modelMesh, this.#raycaster);
	}

	/**
	 * Returns the id of the support marker under the pointer, if any. The hook
	 * for upcoming drag-move / select-and-delete editing of placed supports.
	 */
	pickSupportPoint(event: PointerEvent): string | null {
		if (this.#interactionMode !== 'place-supports') return null;

		this.#setPointer(event);
		const hit = this.#raycaster.intersectObjects([...this.#supportMarkers.pickTargets], false)[0];
		return (hit?.object.userData.supportPointId as string | undefined) ?? null;
	}

	updateModelInteraction(event: PointerEvent): boolean {
		const drag = this.#activeDrag;
		if (!drag || drag.pointerId !== event.pointerId) return false;
		if (drag.kind === 'scale') {
			this.#setPointer(event);
			drag.onChange(
				scaleAlongRay(
					this.#raycaster.ray.origin,
					this.#raycaster.ray.direction,
					drag.anchor,
					drag.handleVector,
					drag.initialScale,
					drag.initialLineParameter
				)
			);
			return true;
		}
		if (drag.kind === 'rotation') {
			this.#setPointer(event);
			const point = this.#raycaster.ray.intersectPlane(drag.plane, new Vector3());
			if (!point) return true;

			const radial = point.sub(drag.center);
			radial.addScaledVector(drag.axis.vector, -radial.dot(drag.axis.vector));
			if (radial.lengthSq() < 1e-8) return true;
			radial.normalize();

			drag.accumulatedAngle += signedRotationAngle(drag.previousRadial, radial, drag.axis.vector);
			drag.previousRadial.copy(radial);
			const angle = snapRotationAngle(drag.accumulatedAngle, event.shiftKey);
			const deltaRotation = new Quaternion().setFromAxisAngle(drag.axis.vector, angle);
			const rotation = deltaRotation.multiply(drag.initialRotation).normalize();
			drag.onChange({ x: rotation.x, y: rotation.y, z: rotation.z, w: rotation.w });
			return true;
		}

		this.#setPointer(event);
		const point = this.#raycaster.ray.intersectPlane(drag.plane, new Vector3());
		if (!point) return true;

		const delta = point.sub(drag.anchor);
		if (drag.axis === 'xy') {
			drag.onChange({
				x: drag.initialTranslation.x + delta.x,
				y: drag.initialTranslation.y + delta.y,
				z: drag.initialTranslation.z
			});
		} else {
			drag.onChange({
				x: drag.initialTranslation.x,
				y: drag.initialTranslation.y,
				z: drag.initialTranslation.z + delta.z
			});
		}
		return true;
	}

	stopModelInteraction(event: PointerEvent): boolean {
		const drag = this.#activeDrag;
		if (!drag || drag.pointerId !== event.pointerId) return false;
		if (this.#canvas.hasPointerCapture(event.pointerId)) {
			this.#canvas.releasePointerCapture(event.pointerId);
		}
		this.#activeDrag = null;
		drag.onInteractionChange(null);
		return true;
	}

	cancel() {
		const drag = this.#activeDrag;
		if (!drag) return;
		if (this.#canvas.hasPointerCapture(drag.pointerId)) {
			this.#canvas.releasePointerCapture(drag.pointerId);
		}
		this.#activeDrag = null;
		drag.onInteractionChange(null);
	}

	#startRotationDrag(
		event: PointerEvent,
		hitPoint: Vector3,
		axis: RotationAxis,
		rotation: ModelRotation,
		onChange: (rotation: ModelRotation) => void,
		onInteractionChange: (interaction: ModelInteraction | null) => void
	): boolean {
		const center = this.#model.worldCenter;
		const radial = hitPoint.clone().sub(center);
		radial.addScaledVector(axis.vector, -radial.dot(axis.vector));
		if (radial.lengthSq() < 1e-8) return false;
		radial.normalize();

		event.preventDefault();
		this.#canvas.setPointerCapture(event.pointerId);
		this.#activeDrag = {
			kind: 'rotation',
			pointerId: event.pointerId,
			axis,
			plane: new Plane().setFromNormalAndCoplanarPoint(axis.vector, center),
			center,
			previousRadial: radial,
			accumulatedAngle: 0,
			initialRotation: modelRotationQuaternion(rotation),
			onChange,
			onInteractionChange
		};
		onInteractionChange({ kind: 'rotation', axis: axis.axis });
		return true;
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
