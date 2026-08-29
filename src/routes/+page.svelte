<script lang="ts">
	import { onDestroy } from 'svelte';

	import { TINYMAKER_PROFILE } from '$lib/printer/tinymaker';
	import DiscardSupportsDialog from '$lib/workspace/DiscardSupportsDialog.svelte';
	import WorkflowHeader from '$lib/workspace/WorkflowHeader.svelte';
	import WorkspaceViewport from '$lib/workspace/WorkspaceViewport.svelte';
	import { importStlFile } from '$lib/workspace/stl-importer';
	import { WorkspaceState, type WorkflowStep } from '$lib/workspace/workspace-state.svelte';

	const workspace = new WorkspaceState();
	onDestroy(() => {
		workspace.autoSupportBuild.dispose();
		workspace.previewBuild.dispose();
	});
	let importState = $state<'idle' | 'loading' | 'error'>('idle');
	let importError = $state('');
	let isDraggingFile = $state(false);
	let dragDepth = 0;

	function formatMillimetres(value: number): string {
		return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
	}

	function formatTranslation(value: number): string {
		const rounded = Math.abs(value) < 0.005 ? 0 : value;
		return `${rounded > 0 ? '+' : ''}${formatMillimetres(rounded)}`;
	}

	function formatDegrees(value: number): string {
		const rounded = Math.abs(value) < 0.05 ? 0 : value;
		return `${formatMillimetres(rounded)}°`;
	}

	function formatFileSize(byteLength: number): string {
		if (byteLength < 1024 * 1024) return `${(byteLength / 1024).toFixed(1)} KB`;
		return `${(byteLength / (1024 * 1024)).toFixed(1)} MB`;
	}

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

		<aside
			class="grid grid-rows-[auto_auto_1fr] border-l border-line bg-panel max-tablet:hidden"
			aria-label="Scene properties"
		>
			<section class="border-b border-line p-[22px]">
				<div class="flex items-start justify-between">
					<div>
						<p class="u-eyebrow mb-1">Scene</p>
						<h2
							class="m-0 text-[14px] font-semibold tracking-[-0.02em]"
							title={workspace.model?.name}
						>
							{workspace.model?.name ?? 'No model loaded'}
						</h2>
					</div>
					<span
						class={[
							'mt-[5px] size-2 rounded-full border-2',
							workspace.model !== null
								? 'border-[#62b7ed] bg-[#62b7ed] shadow-[0_0_8px_rgba(98,183,237,0.7)]'
								: 'border-[#48566a]'
						]}
					></span>
				</div>
				{#if workspace.model}
					<div class="pt-[18px]">
						{#if workspace.step === 'prepare'}
							<div
								class="flex items-center gap-[7px] rounded-[7px] border border-blue/25 bg-blue/10 px-[9px] py-2 text-[10px] font-semibold text-[#86bddf]"
							>
								<span class="u-dot text-blue"></span>Offset X {formatTranslation(
									workspace.modelTranslation.x
								)} · Y
								{formatTranslation(workspace.modelTranslation.y)} · Z
								{formatTranslation(workspace.modelTranslation.z)} mm
							</div>
							<div
								class="mt-[7px] flex items-center gap-[7px] rounded-[7px] border border-purple/30 bg-purple/10 px-[9px] py-2 text-[10px] font-semibold text-[#b8acef]"
							>
								<span class="u-dot text-purple"></span>Rotation X {formatDegrees(
									workspace.rotationDegrees.x
								)} · Y
								{formatDegrees(workspace.rotationDegrees.y)} · Z
								{formatDegrees(workspace.rotationDegrees.z)}
							</div>
						{:else if workspace.step === 'supports'}
							<div class="rounded-lg border border-green/30 bg-green/12 p-3">
								<div
									class="flex items-center gap-[7px] text-[10px] font-bold tracking-[0.04em] text-green-soft uppercase"
								>
									<span class="u-dot text-green"></span>Support placement
								</div>
								{#if workspace.autoSupportBuild.status === 'building'}
									<p class="mt-[9px] mb-[13px] text-[10px] leading-[1.45] text-[#718d7d]">
										Scanning 0.05 mm layers for unsupported regions…
										{Math.round(workspace.autoSupportBuild.progress * 100)}%
									</p>
								{:else if workspace.autoSupportBuild.status === 'error'}
									<p class="mt-[9px] mb-[13px] text-[10px] leading-[1.45] text-[#718d7d]">
										{workspace.autoSupportBuild.error ??
											'Automatic suggestions could not be generated.'} Place supports manually.
									</p>
								{:else if workspace.autoSupportDiagnostics?.meshIsWatertightAtPixelSamples === false}
									<p class="mt-[9px] mb-[13px] text-[10px] leading-[1.45] text-[#718d7d]">
										Automatic suggestions were skipped because the sampled mesh is open. Review the
										model and place supports manually.
									</p>
								{:else if workspace.autoGeneratedSupportCount > 0}
									<p class="mt-[9px] mb-[13px] text-[10px] leading-[1.45] text-[#718d7d]">
										{workspace.autoGeneratedSupportCount} initial suggestions were generated from 0.05
										mm layers. Review them and click the model to add any missing support.
									</p>
								{:else}
									<p class="mt-[9px] mb-[13px] text-[10px] leading-[1.45] text-[#718d7d]">
										No unsupported regions met the initial thresholds. Review the model and click
										its surface to add supports manually.
									</p>
								{/if}
								<strong class="text-[22px] font-[650] text-[#b9f0ce] tabular-nums"
									>{workspace.supportPoints.length}</strong
								>
								<small class="ml-1.5 text-[9px] text-[#6e917b]"
									>{workspace.supportPoints.length === 1 ? 'point placed' : 'points placed'}</small
								>
							</div>
						{:else if workspace.step === 'preview'}
							<div class="rounded-lg border border-green/30 bg-green/12 p-3">
								<div
									class="flex items-center gap-[7px] text-[10px] font-bold tracking-[0.04em] text-green-soft uppercase"
								>
									<span class="u-dot text-green"></span>Sliced preview
								</div>
								{#if workspace.previewBuild.status === 'building'}
									<p class="mt-[9px] mb-[13px] text-[10px] leading-[1.45] text-[#718d7d]">
										Reconstructing the printed result from 0.05 mm layers…
										{Math.round(workspace.previewBuild.progress * 100)}%
									</p>
								{:else if workspace.previewBuild.status === 'error'}
									<p class="mt-[9px] mb-[13px] text-[10px] leading-[1.45] text-[#718d7d]">
										{workspace.previewBuild.error ?? 'The sliced preview could not be generated.'}
									</p>
								{:else}
									<p class="mt-[9px] mb-[13px] text-[10px] leading-[1.45] text-[#718d7d]">
										Model and supports fused into one immutable, voxel-accurate solid.
									</p>
									{#if workspace.previewBuild.status === 'ready' && !workspace.previewBuild.watertight}
										<p class="mt-[9px] mb-[13px] text-[10px] leading-[1.45] text-[#718d7d]">
											The sampled mesh was not watertight, so the preview may differ from the
											printed part.
										</p>
									{/if}
								{/if}
								<strong class="text-[22px] font-[650] text-[#b9f0ce] tabular-nums"
									>{workspace.previewBuild.layerCount || '—'}</strong
								>
								<small class="ml-1.5 text-[9px] text-[#6e917b]"
									>{workspace.previewBuild.layerCount === 1 ? 'layer' : 'layers'} · Z 0–{formatMillimetres(
										workspace.previewBuild.zHeightMm
									)} mm</small
								>
							</div>
						{/if}
						<dl
							class="mt-3 grid text-[10px] [&_dd]:m-0 [&_dd]:text-right [&_dd]:text-ink-2 [&_dd]:tabular-nums [&_dt]:text-ink-5 [&>div]:flex [&>div]:justify-between [&>div]:gap-3 [&>div]:border-b [&>div]:border-line-soft [&>div]:py-2 [&>div:last-child]:border-b-0"
						>
							<div>
								<dt>Dimensions</dt>
								<dd>
									{formatMillimetres(
										workspace.transformedDimensions?.x ?? workspace.model.dimensions.x
									)} ×
									{formatMillimetres(
										workspace.transformedDimensions?.y ?? workspace.model.dimensions.y
									)} ×
									{formatMillimetres(
										workspace.transformedDimensions?.z ?? workspace.model.dimensions.z
									)} mm
								</dd>
							</div>
							<div>
								<dt>Triangles</dt>
								<dd>{workspace.model.triangleCount.toLocaleString()}</dd>
							</div>
							<div>
								<dt>Encoding</dt>
								<dd>{workspace.model.format}</dd>
							</div>
							<div>
								<dt>File size</dt>
								<dd>{formatFileSize(workspace.model.byteLength)}</dd>
							</div>
						</dl>
					</div>
				{:else}
					<div class="flex flex-col items-center px-3 pt-[34px] pb-3 text-center">
						<svg
							class="mb-3.5 w-[47px] fill-[rgba(76,108,139,0.06)] stroke-[#394a5f] [stroke-width:1] [stroke-linejoin:round]"
							viewBox="0 0 48 48"
							aria-hidden="true"
							><path d="m24 6 15 8.5v19L24 42 9 33.5v-19L24 6Z" /><path
								d="m9.5 15 14.5 8.2L38.5 15M24 23.2V42"
							/></svg
						>
						<p class="m-0 mb-[5px] text-[12px] font-semibold text-[#9ba9ba]">
							Your workspace is ready.
						</p>
						<span class="max-w-[190px] text-[10px] leading-normal text-[#58677a]"
							>Open or drop an STL file to begin preparing a print.</span
						>
					</div>
				{/if}
				{#if importError}
					<p
						class="mt-3 rounded-[7px] border border-red/30 bg-red/10 px-[9px] py-2 text-[10px] leading-[1.45] text-red-soft"
						role="alert"
					>
						{importError}
					</p>
				{/if}
			</section>
			<section class="border-b border-line p-[22px]">
				<div class="flex items-start justify-between">
					<div>
						<p class="u-eyebrow mb-1">Printer profile</p>
						<h2 class="m-0 text-[14px] font-semibold tracking-[-0.02em]">
							{TINYMAKER_PROFILE.name}
						</h2>
					</div>
					<span
						class="u-chip gap-[7px] px-[7px] py-1 text-[9px] font-semibold text-[#718198] uppercase"
						>Fixed</span
					>
				</div>
				<dl
					class="mt-[17px] grid text-[10px] [&_dd]:m-0 [&_dd]:text-ink-2 [&_dd]:tabular-nums [&_dt]:text-ink-5 [&>div]:flex [&>div]:justify-between [&>div]:border-b [&>div]:border-line-soft [&>div]:py-[9px] [&>div:last-child]:border-b-0"
				>
					<div>
						<dt>Resolution</dt>
						<dd>{TINYMAKER_PROFILE.resolution.x} × {TINYMAKER_PROFILE.resolution.y} px</dd>
					</div>
					<div>
						<dt>Build area</dt>
						<dd>{TINYMAKER_PROFILE.buildVolume.x} × {TINYMAKER_PROFILE.buildVolume.y} mm</dd>
					</div>
					<div>
						<dt>Max height</dt>
						<dd>{TINYMAKER_PROFILE.buildVolume.z} mm</dd>
					</div>
					<div>
						<dt>Layer height</dt>
						<dd>{TINYMAKER_PROFILE.layerHeight} mm</dd>
					</div>
				</dl>
			</section>
			<footer class="flex items-center gap-[10px] self-end px-[22px] py-[18px] text-[#56677b]">
				<svg
					class="u-icon w-[21px] shrink-0 stroke-[#466d8d] [stroke-width:1.1]"
					viewBox="0 0 18 18"
					aria-hidden="true"
					><path d="M9 2 15 4v5c0 3.2-2.2 5.8-6 7-3.8-1.2-6-3.8-6-7V4l6-2Z" /><path
						d="m6.2 9 1.7 1.7 3.8-4"
					/></svg
				>
				<div class="flex flex-col gap-0.5">
					<strong class="text-[10px] font-semibold text-[#7b8ca0]">Your models stay private</strong
					><span class="text-[9px]">All processing happens in this browser.</span>
				</div>
			</footer>
		</aside>
	</main>
	<DiscardSupportsDialog
		open={workspace.discardSupportsDialogOpen}
		supportCount={workspace.supportPoints.length}
		onCancel={workspace.cancelDiscardSupports}
		onConfirm={workspace.confirmDiscardSupports}
	/>
</div>
