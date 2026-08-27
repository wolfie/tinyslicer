import {
	areBoundsOutsideBuildVolume,
	IDENTITY_MODEL_ROTATION,
	modelRotationDegrees,
	transformModelGeometryBounds,
	translateModelBounds,
	type BuildVolumeInteractionMode,
	type ModelRotation,
	type ModelTranslation
} from './build-volume-renderer';
import type { ImportedStlModel } from './stl-importer';
import { generateSupportPlan, type ModelSurfaceHit, type SupportPoint } from './supports';

export type WorkflowStep = 'prepare' | 'supports' | 'preview' | 'export';

export class WorkspaceState {
	model = $state.raw<ImportedStlModel | null>(null);
	modelTranslation = $state<ModelTranslation>({ x: 0, y: 0, z: 0 });
	modelRotation = $state<ModelRotation>({ ...IDENTITY_MODEL_ROTATION });
	supportPoints = $state.raw<SupportPoint[]>([]);
	step = $state<WorkflowStep>('prepare');
	discardSupportsDialogOpen = $state(false);
	supportPlan = $derived(generateSupportPlan(this.supportPoints));

	rotatedModelBounds = $derived(
		this.model
			? transformModelGeometryBounds(this.model, { x: 0, y: 0, z: 0 }, this.modelRotation)
			: null
	);
	transformedModelBounds = $derived(
		this.rotatedModelBounds
			? translateModelBounds(this.rotatedModelBounds, this.modelTranslation)
			: null
	);
	modelOutsideBuildVolume = $derived(
		this.transformedModelBounds ? areBoundsOutsideBuildVolume(this.transformedModelBounds) : false
	);
	canEnterSupports = $derived(this.model !== null && !this.modelOutsideBuildVolume);
	rotationDegrees = $derived(modelRotationDegrees(this.modelRotation));
	transformedDimensions = $derived.by(() => {
		const bounds = this.rotatedModelBounds;
		if (!bounds) return null;
		return {
			x: bounds.max.x - bounds.min.x,
			y: bounds.max.y - bounds.min.y,
			z: bounds.max.z - bounds.min.z
		};
	});
	interactionMode = $derived<BuildVolumeInteractionMode>(
		this.step === 'prepare'
			? 'transform-model'
			: this.step === 'supports'
				? 'place-supports'
				: 'readonly'
	);

	#nextSupportPointId = 1;

	setModel(model: ImportedStlModel) {
		this.modelTranslation = { x: 0, y: 0, z: 0 };
		this.modelRotation = { ...IDENTITY_MODEL_ROTATION };
		this.supportPoints = [];
		this.discardSupportsDialogOpen = false;
		this.step = 'prepare';
		this.model = model;
	}

	setModelTranslation = (translation: ModelTranslation) => {
		if (this.step !== 'prepare') return;
		this.modelTranslation = translation;
	};

	setModelRotation = (rotation: ModelRotation) => {
		if (this.step !== 'prepare') return;
		this.modelRotation = rotation;
	};

	canNavigateTo(step: WorkflowStep): boolean {
		if (step === 'prepare') return true;
		if (step === 'supports') return this.canEnterSupports;
		return false;
	}

	requestStep(step: WorkflowStep): boolean {
		if (step === this.step) return true;
		if (!this.canNavigateTo(step)) return false;

		if (step === 'prepare' && this.step === 'supports' && this.supportPoints.length > 0) {
			this.discardSupportsDialogOpen = true;
			return false;
		}

		this.step = step;
		return true;
	}

	addSupportPoint(hit: ModelSurfaceHit): boolean {
		if (this.step !== 'supports' || !this.canEnterSupports) return false;
		this.supportPoints = [
			...this.supportPoints,
			{
				id: `support-point-${this.#nextSupportPointId++}`,
				position: { ...hit.position },
				normal: { ...hit.normal }
			}
		];
		return true;
	}

	cancelDiscardSupports = () => {
		this.discardSupportsDialogOpen = false;
	};

	confirmDiscardSupports = () => {
		this.supportPoints = [];
		this.discardSupportsDialogOpen = false;
		this.step = 'prepare';
	};
}
