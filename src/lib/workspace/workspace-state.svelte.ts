import { ProjectExport, type ProjectExportOptions } from './export-state.svelte';
import { PreviewBuild } from './preview-state.svelte';
import { SceneState } from './scene-state.svelte';
import { SliceScanState } from './slice-scan-state.svelte';
import type { ImportedStlModel } from './stl-importer';
import { SupportsState } from './supports-state.svelte';
import { WorkflowState } from './workflow-state.svelte';

export type { WorkflowStep } from './workflow-state.svelte';

export type WorkspaceStateOptions = {
	/** Overrides the automatic-support worker factory (tests inject a synchronous stub). */
	createAutoSupportWorker?: () => Promise<Worker>;
	/** Overrides the support-topology worker factory (tests inject a synchronous stub). */
	createSupportAnalysisWorker?: () => Promise<Worker>;
	/** Overrides the slice worker factory (tests inject a synchronous stub). */
	createPreviewWorker?: () => Promise<Worker>;
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
	readonly preview: PreviewBuild;
	readonly scan: SliceScanState;
	readonly export: ProjectExport;
	readonly workflow: WorkflowState;

	constructor(options: WorkspaceStateOptions = {}) {
		this.preview = new PreviewBuild(options.createPreviewWorker);
		this.scan = new SliceScanState(this.preview);
		this.export = new ProjectExport(options.export);
		this.supports = new SupportsState(
			options.createAutoSupportWorker,
			() => this.workflow.onSupportSetChanged(),
			options.createSupportAnalysisWorker,
			() => this.workflow.onSupportOutputChanged()
		);
		this.workflow = new WorkflowState(
			this.scene,
			this.supports,
			this.preview,
			this.scan,
			this.export
		);
	}

	setModel(model: ImportedStlModel) {
		this.scene.load(model);
		this.supports.reset();
		this.preview.reset();
		this.scan.reset();
		this.workflow.reset();
	}

	dispose() {
		this.supports.dispose();
		this.preview.dispose();
		this.export.dispose();
	}
}
