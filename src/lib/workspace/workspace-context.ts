import { getContext, setContext } from 'svelte';

import type { ProjectExport } from './export-state.svelte';
import type { PreviewBuild } from './preview-state.svelte';
import type { SceneState } from './scene-state.svelte';
import type { SupportsState } from './supports-state.svelte';
import type { WorkflowState } from './workflow-state.svelte';
import type { WorkspaceState } from './workspace-state.svelte';

const SCENE = Symbol('workspace:scene');
const SUPPORTS = Symbol('workspace:supports');
const PREVIEW = Symbol('workspace:preview');
const WORKFLOW = Symbol('workspace:workflow');
const EXPORT = Symbol('workspace:export');

/** Publishes the workspace stores to descendant components. Call once, during init. */
export function provideWorkspace(workspace: WorkspaceState): void {
	setContext(SCENE, workspace.scene);
	setContext(SUPPORTS, workspace.supports);
	setContext(PREVIEW, workspace.preview);
	setContext(WORKFLOW, workspace.workflow);
	setContext(EXPORT, workspace.export);
}

export const useScene = (): SceneState => getContext(SCENE);
export const useSupports = (): SupportsState => getContext(SUPPORTS);
export const usePreview = (): PreviewBuild => getContext(PREVIEW);
export const useWorkflow = (): WorkflowState => getContext(WORKFLOW);
export const useExport = (): ProjectExport => getContext(EXPORT);
