import {
	areBoundsOutsideBuildVolume,
	clampModelScale,
	DEFAULT_MODEL_SCALE,
	findInBoundsZRotation,
	IDENTITY_MODEL_ROTATION,
	modelRotationDegrees,
	transformModelGeometryBounds,
	translateModelBounds
} from './build-volume-renderer/model-transform';
import { TINYMAKER_PROFILE } from '$lib/printer/tinymaker';
import type { ModelRotation, ModelScale, ModelTranslation } from './build-volume-renderer/types';
import type { ImportedStlModel } from './stl-importer';
import { doesModelProjectionOverlapSupportMargin, SUPPORT_PLATE_EDGE_MARGIN_MM } from './supports';

const FIT_CLEARANCE_MM = 0.05;

/**
 * The imported model and its non-destructive placement (translation + rotation
 * quaternion + uniform scale), plus every bounds-derived fact the Prepare step needs. Transform
 * setters are gated by `transformsLocked`, which the workflow flips so the model
 * can only be moved on the Prepare step.
 */
export class SceneState {
	model = $state.raw<ImportedStlModel | null>(null);
	translation = $state<ModelTranslation>({ x: 0, y: 0, z: 0 });
	rotation = $state<ModelRotation>({ ...IDENTITY_MODEL_ROTATION });
	scale = $state<ModelScale>(DEFAULT_MODEL_SCALE);
	transformsLocked = $state(false);

	rotatedBounds = $derived(
		this.model
			? transformModelGeometryBounds(this.model, { x: 0, y: 0, z: 0 }, this.rotation, this.scale)
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

	setScale = (scale: ModelScale) => {
		if (this.transformsLocked) return;
		this.scale = clampModelScale(scale);
	};

	resetScale = () => this.setScale(DEFAULT_MODEL_SCALE);

	fitToBuildVolume = () => {
		if (this.transformsLocked || !this.model) return;
		const bounds = transformModelGeometryBounds(
			this.model,
			{ x: 0, y: 0, z: 0 },
			this.rotation,
			DEFAULT_MODEL_SCALE
		);
		const dimensions = {
			x: bounds.max.x - bounds.min.x,
			y: bounds.max.y - bounds.min.y,
			z: bounds.max.z - bounds.min.z
		};
		const safeDimensions = {
			x: TINYMAKER_PROFILE.buildVolume.x - 2 * SUPPORT_PLATE_EDGE_MARGIN_MM - 2 * FIT_CLEARANCE_MM,
			y: TINYMAKER_PROFILE.buildVolume.y - 2 * SUPPORT_PLATE_EDGE_MARGIN_MM - 2 * FIT_CLEARANCE_MM,
			z: TINYMAKER_PROFILE.buildVolume.z - 2 * FIT_CLEARANCE_MM
		};
		const fittedScale = clampModelScale(
			Math.min(
				dimensions.x > 0 ? safeDimensions.x / dimensions.x : Infinity,
				dimensions.y > 0 ? safeDimensions.y / dimensions.y : Infinity,
				dimensions.z > 0 ? safeDimensions.z / dimensions.z : Infinity
			)
		);
		const fittedBounds = transformModelGeometryBounds(
			this.model,
			{ x: 0, y: 0, z: 0 },
			this.rotation,
			fittedScale
		);
		this.scale = fittedScale;
		this.translation = {
			x: TINYMAKER_PROFILE.buildVolume.x / 2 - (fittedBounds.min.x + fittedBounds.max.x) / 2,
			y: TINYMAKER_PROFILE.buildVolume.y / 2 - (fittedBounds.min.y + fittedBounds.max.y) / 2,
			z: -fittedBounds.min.z
		};
	};

	load(model: ImportedStlModel) {
		this.translation = { x: 0, y: 0, z: 0 };
		this.rotation = findInBoundsZRotation(model);
		this.scale = DEFAULT_MODEL_SCALE;
		this.transformsLocked = false;
		this.model = model;
	}
}
