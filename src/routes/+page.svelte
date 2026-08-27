<script lang="ts">
	import { TINYMAKER_PROFILE } from '$lib/printer/tinymaker';
	import DiscardSupportsDialog from '$lib/workspace/DiscardSupportsDialog.svelte';
	import WorkflowHeader from '$lib/workspace/WorkflowHeader.svelte';
	import WorkspaceViewport from '$lib/workspace/WorkspaceViewport.svelte';
	import { importStlFile } from '$lib/workspace/stl-importer';
	import { WorkspaceState, type WorkflowStep } from '$lib/workspace/workspace-state.svelte';

	const workspace = new WorkspaceState();
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

<div class="app-shell">
	{#if isDraggingFile}
		<div class="drop-overlay" role="status" aria-live="polite">
			<div class="drop-card">
				<svg viewBox="0 0 48 48" aria-hidden="true">
					<path d="M24 32V9m0 0-8 8m8-8 8 8M9 30v8h30v-8" />
				</svg>
				<strong>Drop STL to import</strong>
				<span>ASCII or binary · processed locally</span>
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

	<main class="workspace">
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
			supportStructures={workspace.supportPlan.structures}
			onTranslationChange={workspace.setModelTranslation}
			onRotationChange={workspace.setModelRotation}
			onSupportPointPlaced={(hit) => workspace.addSupportPoint(hit)}
			onEnterSupports={() => requestStep('supports')}
			onBackToPrepare={() => requestStep('prepare')}
		/>

		<aside class="properties" aria-label="Scene properties">
			<section class="property-section scene-section">
				<div class="section-heading">
					<div>
						<p class="eyebrow">Scene</p>
						<h2 title={workspace.model?.name}>{workspace.model?.name ?? 'No model loaded'}</h2>
					</div>
					<span class={['empty-dot', { loaded: workspace.model !== null }]}></span>
				</div>
				{#if workspace.model}
					<div class="model-state">
						{#if workspace.step === 'prepare'}
							<div class="model-position">
								<span></span>Offset X {formatTranslation(workspace.modelTranslation.x)} · Y
								{formatTranslation(workspace.modelTranslation.y)} · Z
								{formatTranslation(workspace.modelTranslation.z)} mm
							</div>
							<div class="model-rotation">
								<span></span>Rotation X {formatDegrees(workspace.rotationDegrees.x)} · Y
								{formatDegrees(workspace.rotationDegrees.y)} · Z
								{formatDegrees(workspace.rotationDegrees.z)}
							</div>
						{:else if workspace.step === 'supports'}
							<div class="support-mode-summary">
								<div class="support-mode-heading"><span></span>Support placement</div>
								{#if workspace.autoSupportDiagnostics?.meshIsWatertightAtPixelSamples === false}
									<p>
										Automatic suggestions were skipped because the sampled mesh is open. Review the
										model and place supports manually.
									</p>
								{:else if workspace.autoGeneratedSupportCount > 0}
									<p>
										{workspace.autoGeneratedSupportCount} initial suggestions were generated from 0.05
										mm layers. Review them and click the model to add any missing support.
									</p>
								{:else}
									<p>
										No unsupported regions met the initial thresholds. Review the model and click
										its surface to add supports manually.
									</p>
								{/if}
								<strong>{workspace.supportPoints.length}</strong>
								<small
									>{workspace.supportPoints.length === 1 ? 'point placed' : 'points placed'}</small
								>
							</div>
						{/if}
						<dl class="model-details">
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
					<div class="empty-state">
						<svg viewBox="0 0 48 48" aria-hidden="true"
							><path d="m24 6 15 8.5v19L24 42 9 33.5v-19L24 6Z" /><path
								d="m9.5 15 14.5 8.2L38.5 15M24 23.2V42"
							/></svg
						>
						<p>Your workspace is ready.</p>
						<span>Open or drop an STL file to begin preparing a print.</span>
					</div>
				{/if}
				{#if importError}
					<p class="import-error" role="alert">{importError}</p>
				{/if}
			</section>
			<section class="property-section profile-section">
				<div class="section-heading">
					<div>
						<p class="eyebrow">Printer profile</p>
						<h2>{TINYMAKER_PROFILE.name}</h2>
					</div>
					<span class="fixed-badge">Fixed</span>
				</div>
				<dl class="profile-grid">
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
			<footer class="privacy-note">
				<svg viewBox="0 0 18 18" aria-hidden="true"
					><path d="M9 2 15 4v5c0 3.2-2.2 5.8-6 7-3.8-1.2-6-3.8-6-7V4l6-2Z" /><path
						d="m6.2 9 1.7 1.7 3.8-4"
					/></svg
				>
				<div>
					<strong>Your models stay private</strong><span
						>All processing happens in this browser.</span
					>
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

<style>
	:global(*) {
		box-sizing: border-box;
	}
	:global(html) {
		background: #0a0f16;
	}
	:global(body) {
		margin: 0;
		min-width: 320px;
		min-height: 100vh;
		background: #0a0f16;
		color: #edf4fc;
		font-family:
			Inter,
			ui-sans-serif,
			system-ui,
			-apple-system,
			BlinkMacSystemFont,
			'Segoe UI',
			sans-serif;
	}
	:global(button),
	:global(canvas) {
		font: inherit;
	}
	.app-shell {
		min-height: 100vh;
		background:
			radial-gradient(circle at 48% -20%, rgba(37, 78, 109, 0.16), transparent 37rem), #0a0f16;
	}
	.drop-overlay {
		position: fixed;
		z-index: 1000;
		inset: 0;
		display: grid;
		place-items: center;
		border: 2px solid rgba(103, 193, 246, 0.8);
		background: rgba(7, 14, 22, 0.82);
		backdrop-filter: blur(7px);
		pointer-events: none;
	}
	.drop-card {
		display: flex;
		align-items: center;
		flex-direction: column;
		min-width: min(360px, calc(100vw - 40px));
		padding: 36px 44px;
		border: 1px solid rgba(103, 193, 246, 0.5);
		border-radius: 16px;
		background: linear-gradient(145deg, rgba(26, 61, 87, 0.94), rgba(13, 27, 40, 0.96));
		box-shadow:
			0 24px 80px rgba(0, 0, 0, 0.45),
			inset 0 1px rgba(255, 255, 255, 0.08);
		text-align: center;
	}
	.drop-card svg {
		width: 48px;
		margin-bottom: 16px;
		fill: none;
		stroke: #75c8ff;
		stroke-linecap: round;
		stroke-linejoin: round;
		stroke-width: 2;
		filter: drop-shadow(0 0 10px rgba(103, 193, 246, 0.45));
	}
	.drop-card strong {
		color: #e2f3ff;
		font-size: 17px;
		font-weight: 650;
	}
	.drop-card span {
		margin-top: 7px;
		color: #83a8c1;
		font-size: 11px;
	}
	.workspace {
		display: grid;
		grid-template-columns: minmax(0, 1fr) 288px;
		height: calc(100vh - 68px);
		min-height: 560px;
	}
	.section-heading {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
	}
	.eyebrow {
		margin: 0 0 4px;
		color: #65768d;
		font-size: 9px;
		font-weight: 700;
		letter-spacing: 0.14em;
		text-transform: uppercase;
	}
	h2 {
		margin: 0;
		font-weight: 600;
		letter-spacing: -0.02em;
	}
	h2 {
		font-size: 14px;
	}
	.fixed-badge {
		display: inline-flex;
		align-items: center;
		gap: 7px;
		padding: 6px 9px;
		border: 1px solid #243247;
		border-radius: 7px;
		background: #101823;
		color: #8c9caf;
		font-size: 10px;
		font-weight: 600;
	}
	.properties {
		display: grid;
		grid-template-rows: auto auto 1fr;
		border-left: 1px solid #1c2634;
		background: #0d141e;
	}
	.property-section {
		padding: 22px;
		border-bottom: 1px solid #1c2634;
	}
	.empty-dot {
		width: 8px;
		height: 8px;
		margin-top: 5px;
		border: 2px solid #48566a;
		border-radius: 50%;
	}
	.empty-dot.loaded {
		border-color: #62b7ed;
		background: #62b7ed;
		box-shadow: 0 0 8px rgba(98, 183, 237, 0.7);
	}
	.empty-state {
		display: flex;
		align-items: center;
		flex-direction: column;
		padding: 34px 12px 12px;
		text-align: center;
	}
	.empty-state svg {
		width: 47px;
		margin-bottom: 14px;
		fill: rgba(76, 108, 139, 0.06);
		stroke: #394a5f;
		stroke-linejoin: round;
		stroke-width: 1;
	}
	.empty-state p {
		margin: 0 0 5px;
		color: #9ba9ba;
		font-size: 12px;
		font-weight: 600;
	}
	.empty-state span {
		max-width: 190px;
		color: #58677a;
		font-size: 10px;
		line-height: 1.5;
	}
	.model-state {
		padding-top: 18px;
	}
	.model-position,
	.model-rotation {
		display: flex;
		align-items: center;
		gap: 7px;
		padding: 8px 9px;
		border: 1px solid rgba(75, 137, 180, 0.25);
		border-radius: 7px;
		background: rgba(38, 91, 127, 0.12);
		color: #86bddf;
		font-size: 10px;
		font-weight: 600;
	}
	.model-rotation {
		margin-top: 7px;
		border-color: rgba(118, 105, 211, 0.28);
		background: rgba(83, 67, 156, 0.11);
		color: #b8acef;
	}
	.model-position span,
	.model-rotation span {
		width: 6px;
		height: 6px;
		flex: 0 0 auto;
		border-radius: 50%;
		background: #67c1f6;
		box-shadow: 0 0 6px rgba(103, 193, 246, 0.75);
	}
	.model-rotation span {
		background: #a99af1;
		box-shadow: 0 0 6px rgba(169, 154, 241, 0.72);
	}
	.support-mode-summary {
		padding: 12px;
		border: 1px solid rgba(87, 220, 139, 0.27);
		border-radius: 8px;
		background: rgba(23, 75, 44, 0.14);
	}
	.support-mode-heading {
		display: flex;
		align-items: center;
		gap: 7px;
		color: #8ed9ab;
		font-size: 10px;
		font-weight: 700;
		letter-spacing: 0.04em;
		text-transform: uppercase;
	}
	.support-mode-heading span {
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: #57dc8b;
		box-shadow: 0 0 7px rgba(87, 220, 139, 0.72);
	}
	.support-mode-summary p {
		margin: 9px 0 13px;
		color: #718d7d;
		font-size: 10px;
		line-height: 1.45;
	}
	.support-mode-summary strong {
		color: #b9f0ce;
		font-size: 22px;
		font-weight: 650;
		font-variant-numeric: tabular-nums;
	}
	.support-mode-summary small {
		margin-left: 6px;
		color: #6e917b;
		font-size: 9px;
	}
	.model-details {
		display: grid;
		margin: 12px 0 0;
	}
	.model-details div {
		display: flex;
		justify-content: space-between;
		gap: 12px;
		padding: 8px 0;
		border-bottom: 1px solid #192330;
		font-size: 10px;
	}
	.model-details div:last-child {
		border-bottom: 0;
	}
	.model-details dt {
		color: #5f6e81;
	}
	.model-details dd {
		margin: 0;
		color: #a4b2c3;
		text-align: right;
		font-variant-numeric: tabular-nums;
	}
	.import-error {
		margin: 12px 0 0;
		padding: 8px 9px;
		border: 1px solid rgba(226, 94, 102, 0.28);
		border-radius: 7px;
		background: rgba(126, 34, 40, 0.13);
		color: #f09a9f;
		font-size: 10px;
		line-height: 1.45;
	}
	.fixed-badge {
		padding: 4px 7px;
		color: #718198;
		font-size: 9px;
		text-transform: uppercase;
	}
	.profile-grid {
		display: grid;
		gap: 0;
		margin: 17px 0 0;
	}
	.profile-grid div {
		display: flex;
		justify-content: space-between;
		padding: 9px 0;
		border-bottom: 1px solid #192330;
		font-size: 10px;
	}
	.profile-grid div:last-child {
		border-bottom: 0;
	}
	.profile-grid dt {
		color: #5f6e81;
	}
	.profile-grid dd {
		margin: 0;
		color: #a4b2c3;
		font-variant-numeric: tabular-nums;
	}
	.privacy-note {
		align-self: end;
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 18px 22px;
		color: #56677b;
	}
	.privacy-note svg {
		width: 21px;
		flex: 0 0 auto;
		fill: none;
		stroke: #466d8d;
		stroke-linecap: round;
		stroke-linejoin: round;
		stroke-width: 1.1;
	}
	.privacy-note div {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.privacy-note strong {
		color: #7b8ca0;
		font-size: 10px;
		font-weight: 600;
	}
	.privacy-note span {
		font-size: 9px;
	}
	@media (max-width: 820px) {
		.workspace {
			grid-template-columns: 1fr;
			height: calc(100vh - 68px);
		}
		.properties {
			display: none;
		}
	}
</style>
