import type { BuildVolumeInteractionMode } from './build-volume-renderer/types';
import type { ProjectExport } from './export-state.svelte';
import type { PreviewBuild } from './preview-state.svelte';
import type { SceneState } from './scene-state.svelte';
import type { SliceScanState } from './slice-scan-state.svelte';
import type { ModelSurfaceHit } from './supports';
import type { SupportsState } from './supports-state.svelte';

export type WorkflowStep = 'prepare' | 'supports' | 'preview' | 'export';

/**
 * The workflow step machine and the imperative glue between the scene, support,
 * and preview stores: gating navigation, seeding the first support draft on
 * entry, locking model transforms outside Prepare, and (re)building the preview.
 */
export class WorkflowState {
	step = $state<WorkflowStep>('prepare');
	discardDialogOpen = $state(false);

	interactionMode = $derived<BuildVolumeInteractionMode>(
		this.step === 'prepare'
			? 'transform-model'
			: this.step === 'supports'
				? 'place-supports'
				: 'readonly'
	);

	#scene: SceneState;
	#supports: SupportsState;
	#preview: PreviewBuild;
	#scan: SliceScanState;
	#export: ProjectExport;

	constructor(
		scene: SceneState,
		supports: SupportsState,
		preview: PreviewBuild,
		scan: SliceScanState,
		exportState: ProjectExport
	) {
		this.#scene = scene;
		this.#supports = supports;
		this.#preview = preview;
		this.#scan = scan;
		this.#export = exportState;
	}

	/** Whether the model is placed well enough to enter Supports/Preview. */
	get canEnterSupports(): boolean {
		return this.#scene.isPlaceable;
	}

	canNavigateTo(step: WorkflowStep): boolean {
		if (step === 'prepare') return true;
		if (step === 'supports' || step === 'preview') return this.#scene.isPlaceable;
		return (
			this.#scene.isPlaceable &&
			this.#supports.autoBuild.status !== 'building' &&
			this.#preview.status === 'ready' &&
			this.#preview.mesh !== null
		);
	}

	requestStep(step: WorkflowStep): boolean {
		if (step === this.step) return true;
		if (
			this.step === 'export' &&
			(this.#export.status === 'picking' || this.#export.status === 'slicing')
		) {
			return false;
		}
		if (!this.canNavigateTo(step)) return false;

		if (
			step === 'prepare' &&
			(this.step === 'supports' || this.step === 'preview' || this.step === 'export') &&
			this.#supports.points.length > 0
		) {
			this.discardDialogOpen = true;
			return false;
		}

		if (step === 'supports' || step === 'preview') {
			this.#generateInitialSupports();
		} else if (step === 'prepare') {
			// Only reachable with no supports placed yet (the discard dialog guards the
			// rest): cancel an in-flight scan so its draft never lands on the Prepare step.
			this.#supports.autoBuild.reset();
		}

		this.#setStep(step);
		if (step === 'preview') this.#requestPreview();
		return true;
	}

	placeSupport(hit: ModelSurfaceHit): boolean {
		if (this.step !== 'supports' || !this.#scene.isPlaceable) return false;
		return this.#supports.add(hit);
	}

	cancelDiscard = () => {
		this.discardDialogOpen = false;
	};

	confirmDiscard = () => {
		this.#supports.reset();
		this.#preview.reset();
		this.#scan.reset();
		this.discardDialogOpen = false;
		this.#setStep('prepare');
	};

	/** Wired by the composition root whenever manual or automatic supports change. */
	onSupportSetChanged() {
		this.#preview.reset();
		this.#scan.reset();
		if (this.step === 'preview') this.#requestPreview();
	}

	reset() {
		this.#export.reset();
		this.discardDialogOpen = false;
		this.#setStep('prepare');
	}

	#setStep(step: WorkflowStep) {
		this.step = step;
		this.#scene.transformsLocked = step !== 'prepare';
	}

	#generateInitialSupports() {
		const model = this.#scene.model;
		if (!model) return;
		this.#supports.generateInitial({
			model,
			translation: this.#scene.translation,
			rotation: this.#scene.rotation,
			scale: this.#scene.scale
		});
	}

	#requestPreview() {
		const model = this.#scene.model;
		if (!model || this.#scene.outsideBuildVolume) return;
		this.#preview.request({
			model,
			translation: this.#scene.translation,
			rotation: this.#scene.rotation,
			scale: this.#scene.scale,
			supportPlan: this.#supports.plan,
			raftIslands: this.#supports.raftPlan.islands
		});
	}
}
