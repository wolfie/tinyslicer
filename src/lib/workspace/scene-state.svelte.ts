import {
	areBoundsOutsideBuildVolume,
	findInBoundsZRotation,
	IDENTITY_MODEL_ROTATION,
	modelRotationDegrees,
	transformModelGeometryBounds,
	translateModelBounds
} from './build-volume-renderer/model-transform';
import type { ModelRotation, ModelTranslation } from './build-volume-renderer/types';
import type { ImportedStlModel } from './stl-importer';
import { doesModelProjectionOverlapSupportMargin } from './supports';

/**
 * The imported model and its non-destructive placement (translation + rotation
 * quaternion), plus every bounds-derived fact the Prepare step needs. Transform
 * setters are gated by `transformsLocked`, which the workflow flips so the model
 * can only be moved on the Prepare step.
 */
export class SceneState {
	model = $state.raw<ImportedStlModel | null>(null);
	translation = $state<ModelTranslation>({ x: 0, y: 0, z: 0 });
	rotation = $state<ModelRotation>({ ...IDENTITY_MODEL_ROTATION });
	transformsLocked = $state(false);

	rotatedBounds = $derived(
		this.model
			? transformModelGeometryBounds(this.model, { x: 0, y: 0, z: 0 }, this.rotation)
			: null
	);
	transformedBounds = $derived(
		this.rotatedBounds ? translateModelBounds(this.rotatedBounds, this.translation) : null
	);
	outsideBuildVolume = $derived(
		this.transformedBounds ? areBoundsOutsideBuildVolume(this.transformedBounds) : false
	);
	overlapsSupportMargin = $derived(
		this.transformedBounds && !this.outsideBuildVolume
			? doesModelProjectionOverlapSupportMargin(this.transformedBounds)
			: false
	);
	/** A model is loaded and it fits the build volume — the gate for Supports/Preview. */
	isPlaceable = $derived(this.model !== null && !this.outsideBuildVolume);
	rotationDegrees = $derived(modelRotationDegrees(this.rotation));
	transformedDimensions = $derived.by(() => {
		const bounds = this.rotatedBounds;
		if (!bounds) return null;
		return {
			x: bounds.max.x - bounds.min.x,
			y: bounds.max.y - bounds.min.y,
			z: bounds.max.z - bounds.min.z
		};
	});

	setTranslation = (translation: ModelTranslation) => {
		if (this.transformsLocked) return;
		this.translation = translation;
	};

	setRotation = (rotation: ModelRotation) => {
		if (this.transformsLocked) return;
		this.rotation = rotation;
	};

	load(model: ImportedStlModel) {
		this.translation = { x: 0, y: 0, z: 0 };
		this.rotation = findInBoundsZRotation(model);
		this.transformsLocked = false;
		this.model = model;
	}
}
