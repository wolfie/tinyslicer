<script lang="ts">
	import { onDestroy } from 'svelte';

	import DiscardSupportsDialog from '$lib/workspace/DiscardSupportsDialog.svelte';
	import WorkflowHeader from '$lib/workspace/WorkflowHeader.svelte';
	import WorkspaceViewport from '$lib/workspace/WorkspaceViewport.svelte';
	import { importStlFile } from '$lib/workspace/stl-importer';
	import { WorkspaceState, type WorkflowStep } from '$lib/workspace/workspace-state.svelte';
	import WorkspaceAside from '../lib/workspace/WorkspaceAside.svelte';

	const workspace = new WorkspaceState();
	onDestroy(() => {
		workspace.autoSupportBuild.dispose();
		workspace.previewBuild.dispose();
	});
	let importState = $state<'idle' | 'loading' | 'error'>('idle');
	let importError = $state('');
	let isDraggingFile = $state(false);
	let dragDepth = 0;

	async function loadStl(file: File) {
		importState = 'loading';
		importError = '';
		try {
			const importedModel = await importStlFile(file);
			workspace.setModel(importedModel);
			importState = 'idle';
		} catch (error) {
			importState = 'error';
			importError = error instanceof Error ? error.message : 'The STL could not be imported.';
		}
	}

	async function handleStlSelection(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		if (file) await loadStl(file);
		input.value = '';
	}

	function isFileDrag(event: DragEvent): boolean {
		return event.dataTransfer?.types.includes('Files') ?? false;
	}

	function handleDragEnter(event: DragEvent) {
		if (!isFileDrag(event)) return;
		event.preventDefault();
		dragDepth += 1;
		isDraggingFile = true;
	}

	function handleDragOver(event: DragEvent) {
		if (!isFileDrag(event)) return;
		event.preventDefault();
		if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
	}

	function handleDragLeave(event: DragEvent) {
		if (!isFileDrag(event)) return;
		dragDepth = Math.max(0, dragDepth - 1);
		if (dragDepth === 0) isDraggingFile = false;
	}

	async function handleDrop(event: DragEvent) {
		if (!isFileDrag(event)) return;
		event.preventDefault();
		dragDepth = 0;
		isDraggingFile = false;

		const files = Array.from(event.dataTransfer?.files ?? []);
		const file =
			files.find((candidate) => candidate.name.toLowerCase().endsWith('.stl')) ?? files[0];
		if (file) await loadStl(file);
	}

	function requestStep(step: WorkflowStep) {
		workspace.requestStep(step);
	}
</script>

<svelte:window
	ondragenter={handleDragEnter}
	ondragover={handleDragOver}
	ondragleave={handleDragLeave}
	ondrop={handleDrop}
/>

<svelte:head>
	<title>TinySlicer</title>
	<meta
		name="description"
		content="A lightweight, browser-based slicer for the TinyMaker resin printer"
	/>
</svelte:head>

<div
	class="min-h-screen bg-bg bg-[radial-gradient(circle_at_48%_-20%,rgba(37,78,109,0.16),transparent_37rem)]"
>
	{#if isDraggingFile}
		<div
			class="pointer-events-none fixed inset-0 z-[1000] grid place-items-center border-2 border-[rgba(103,193,246,0.8)] bg-[rgba(7,14,22,0.82)] backdrop-blur-[7px]"
			role="status"
			aria-live="polite"
		>
			<div
				class="flex min-w-[min(360px,calc(100vw_-_40px))] flex-col items-center rounded-2xl border border-[rgba(103,193,246,0.5)] bg-[linear-gradient(145deg,rgba(26,61,87,0.94),rgba(13,27,40,0.96))] px-11 py-9 text-center shadow-[0_24px_80px_rgba(0,0,0,0.45),inset_0_1px_rgba(255,255,255,0.08)]"
			>
				<svg
					class="u-icon mb-4 w-12 stroke-[#75c8ff] stroke-2 drop-shadow-[0_0_10px_rgba(103,193,246,0.45)]"
					viewBox="0 0 48 48"
					aria-hidden="true"
				>
					<path d="M24 32V9m0 0-8 8m8-8 8 8M9 30v8h30v-8" />
				</svg>
				<strong class="text-[17px] font-[650] text-[#e2f3ff]">Drop STL to import</strong>
				<span class="mt-[7px] text-[11px] text-[#83a8c1]">ASCII or binary · processed locally</span>
			</div>
		</div>
	{/if}
	<WorkflowHeader
		currentStep={workspace.step}
		canEnterSupports={workspace.canEnterSupports}
		importing={importState === 'loading'}
		onStepRequest={requestStep}
		onFileSelection={handleStlSelection}
	/>

	<main
		class="grid h-[calc(100vh_-_68px)] min-h-[560px] grid-cols-[minmax(0,1fr)_288px] max-tablet:grid-cols-[1fr]"
	>
		<WorkspaceViewport
			model={workspace.model}
			modelTranslation={workspace.modelTranslation}
			modelRotation={workspace.modelRotation}
			transformedModelBounds={workspace.transformedModelBounds}
			modelOutsideBuildVolume={workspace.modelOutsideBuildVolume}
			modelOverlapsSupportMargin={workspace.modelOverlapsSupportMargin}
			canEnterSupports={workspace.canEnterSupports}
			interactionMode={workspace.interactionMode}
			supportPointCount={workspace.supportPoints.length}
			supportPoints={workspace.supportPoints}
			supportStructures={workspace.supportPlan.structures}
			autoSupportStatus={workspace.autoSupportBuild.status}
			autoSupportProgress={workspace.autoSupportBuild.progress}
			previewStatus={workspace.previewBuild.status}
			previewProgress={workspace.previewBuild.progress}
			previewMesh={workspace.previewBuild.mesh}
			previewLayerCount={workspace.previewBuild.layerCount}
			previewZHeightMm={workspace.previewBuild.zHeightMm}
			previewWatertight={workspace.previewBuild.watertight}
			previewError={workspace.previewBuild.error}
			onTranslationChange={workspace.setModelTranslation}
			onRotationChange={workspace.setModelRotation}
			onSupportPointPlaced={(hit) => workspace.addSupportPoint(hit)}
			onEnterSupports={() => requestStep('supports')}
			onEnterPreview={() => requestStep('preview')}
			onBackToPrepare={() => requestStep('prepare')}
			onBackToSupports={() => requestStep('supports')}
		/>

		<WorkspaceAside {workspace} {importError} />
	</main>
	<DiscardSupportsDialog
		open={workspace.discardSupportsDialogOpen}
		supportCount={workspace.supportPoints.length}
		onCancel={workspace.cancelDiscardSupports}
		onConfirm={workspace.confirmDiscardSupports}
	/>
</div>
