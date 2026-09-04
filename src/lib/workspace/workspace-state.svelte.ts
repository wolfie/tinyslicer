import { ProjectExport, type ProjectExportOptions } from './export-state.svelte';
import { PreviewBuild } from './preview-state.svelte';
import { SceneState } from './scene-state.svelte';
import type { ImportedStlModel } from './stl-importer';
import { SupportsState } from './supports-state.svelte';
import { WorkflowState } from './workflow-state.svelte';

export type { WorkflowStep } from './workflow-state.svelte';

export type WorkspaceStateOptions = {
	/** Overrides the automatic-support worker factory (tests inject a synchronous stub). */
	createAutoSupportWorker?: () => Promise<Worker>;
	export?: ProjectExportOptions;
};

/**
 * Composition root. Owns the four focused reactive stores and wires the handful
 * of cross-store reactions between them. Components read the individual stores
 * from context (`workspace-context.ts`), not this object; `+page.svelte`
 * instantiates it once and calls `provideWorkspace`.
 */
export class WorkspaceState {
	readonly scene = new SceneState();
	readonly supports: SupportsState;
	readonly preview = new PreviewBuild();
	readonly export: ProjectExport;
	readonly workflow: WorkflowState;

	constructor(options: WorkspaceStateOptions = {}) {
		this.export = new ProjectExport(options.export);
		this.supports = new SupportsState(options.createAutoSupportWorker, () =>
			this.workflow.onSupportSetChanged()
		);
		this.workflow = new WorkflowState(this.scene, this.supports, this.preview, this.export);
	}

	setModel(model: ImportedStlModel) {
		this.scene.load(model);
		this.supports.reset();
		this.preview.reset();
		this.workflow.reset();
	}

	dispose() {
		this.supports.autoBuild.dispose();
		this.preview.dispose();
		this.export.dispose();
	}
}
