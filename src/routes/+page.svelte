<script lang="ts">
	import { TINYMAKER_PROFILE } from '$lib/printer/tinymaker';
	import {
		initializeBuildVolume,
		isModelOutsideBuildVolume,
		paintBuildVolume
	} from '$lib/workspace/build-volume-renderer';
	import { CanvasMetrics } from '$lib/workspace/canvas-metrics.svelte';
	import { OrbitCamera } from '$lib/workspace/orbit-camera.svelte';
	import { importStlFile, type ImportedStlModel } from '$lib/workspace/stl-importer';

	const camera = new OrbitCamera();
	const canvasMetrics = new CanvasMetrics();
	let model = $state.raw<ImportedStlModel | null>(null);
	let importState = $state<'idle' | 'loading' | 'error'>('idle');
	let importError = $state('');
	let isDraggingFile = $state(false);
	let modelOutsideBuildVolume = $derived(model ? isModelOutsideBuildVolume(model) : false);
	let dragDepth = 0;

	function formatMillimetres(value: number): string {
		return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
	}

	function formatFileSize(byteLength: number): string {
		if (byteLength < 1024 * 1024) return `${(byteLength / 1024).toFixed(1)} KB`;
		return `${(byteLength / (1024 * 1024)).toFixed(1)} MB`;
	}

	async function loadStl(file: File) {
		importState = 'loading';
		importError = '';
		try {
			model = await importStlFile(file);
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
	<header class="topbar">
		<div class="brand" aria-label="TinySlicer">
			<span class="brand-mark" aria-hidden="true"
				><svg viewBox="0 0 32 32"
					><path d="M16 3.5 27 9.7v12.6L16 28.5 5 22.3V9.7L16 3.5Z" /><path
						d="m5.5 10 10.5 6 10.5-6M16 16v12"
					/></svg
				></span
			>
			<span>Tiny<span>Slicer</span></span>
		</div>
		<nav class="workflow" aria-label="Slicing workflow">
			<span class="workflow-step active"><b>1</b> Prepare</span><span
				class="workflow-divider"
				aria-hidden="true"
			></span>
			<span class="workflow-step"><b>2</b> Preview</span><span
				class="workflow-divider"
				aria-hidden="true"
			></span>
			<span class="workflow-step"><b>3</b> Export</span>
		</nav>
		<div class="topbar-actions">
			<span class="local-badge"
				><svg viewBox="0 0 16 16" aria-hidden="true"
					><path d="M8 1.5 13 3v4.2c0 3.1-2 5.9-5 7.3-3-1.4-5-4.2-5-7.3V3l5-1.5Z" /></svg
				>Local only</span
			>
			<input
				id="stl-file-input"
				class="file-input"
				type="file"
				accept=".stl,model/stl,application/sla"
				disabled={importState === 'loading'}
				onchange={handleStlSelection}
			/>
			<label
				class="open-button"
				class:disabled={importState === 'loading'}
				for="stl-file-input"
				aria-disabled={importState === 'loading'}
				><svg viewBox="0 0 18 18" aria-hidden="true"
					><path d="M9 12.5v-9m0 0L5.8 6.7M9 3.5l3.2 3.2M3 11.5v3h12v-3" /></svg
				>{importState === 'loading' ? 'Importing…' : 'Open STL'}</label
			>
		</div>
	</header>

	<main class="workspace">
		<section class="viewport-panel" aria-label="3D printer build volume">
			<div class="viewport-heading">
				<div>
					<p class="eyebrow">3D workspace</p>
					<h1>Build volume</h1>
				</div>
				<div class="view-chip"><span></span> Perspective</div>
			</div>
			<div class="viewport-canvas" class:orbiting={camera.orbiting}>
				<canvas
					{@attach canvasMetrics.observe}
					{@attach initializeBuildVolume}
					{@attach paintBuildVolume({
						cameraYaw: camera.yaw,
						cameraPitch: camera.pitch,
						width: canvasMetrics.width,
						height: canvasMetrics.height,
						dpr: canvasMetrics.dpr,
						model
					})}
					onpointerdown={camera.start}
					onpointermove={camera.update}
					onpointerup={camera.stop}
					onpointercancel={camera.stop}
					onauxclick={(event) => event.preventDefault()}
					aria-label={`Interactive 3D view of the ${TINYMAKER_PROFILE.buildVolume.x} by ${TINYMAKER_PROFILE.buildVolume.y} by ${TINYMAKER_PROFILE.buildVolume.z} millimetre ${TINYMAKER_PROFILE.name} build volume${model ? ` containing ${model.name}` : ''}. Drag with the middle mouse button to orbit.`}
				></canvas>
				<div class="axis-legend" aria-label="Axis directions">
					<span class="axis-x"><i></i>X <small>{TINYMAKER_PROFILE.buildVolume.x} mm</small></span>
					<span class="axis-y"><i></i>Y <small>{TINYMAKER_PROFILE.buildVolume.y} mm</small></span>
					<span class="axis-z"><i></i>Z <small>{TINYMAKER_PROFILE.buildVolume.z} mm</small></span>
				</div>
				<div class="coordinate-note">
					<svg viewBox="0 0 18 18" aria-hidden="true"
						><circle cx="9" cy="9" r="7" /><path d="M9 8v4m0-7v.1" /></svg
					>X/Y origin is the upper-left of the layer image · Z=0 is the build plate
				</div>
				<div class="orbit-hint" class:active={camera.orbiting}>
					<span class="mouse-icon" aria-hidden="true"><i></i></span><span
						>{camera.orbiting ? 'Orbiting view' : 'Middle-drag to orbit'}</span
					>
				</div>
				{#if modelOutsideBuildVolume}
					<div class="volume-warning" role="alert">
						<svg viewBox="0 0 24 24" aria-hidden="true">
							<path d="M12 3 22 20H2L12 3Z" />
							<path d="M12 9v5m0 3v.1" />
						</svg>
						<div>
							<strong>Outside print volume</strong>
							<span>The model extends beyond the printable area.</span>
						</div>
					</div>
				{/if}
			</div>
		</section>

		<aside class="properties" aria-label="Scene properties">
			<section class="property-section scene-section">
				<div class="section-heading">
					<div>
						<p class="eyebrow">Scene</p>
						<h2 title={model?.name}>{model?.name ?? 'No model loaded'}</h2>
					</div>
					<span class="empty-dot" class:loaded={model !== null}></span>
				</div>
				{#if model}
					<div class="model-state">
						<div class="model-position"><span></span>Centered on build plate</div>
						<dl class="model-details">
							<div>
								<dt>Dimensions</dt>
								<dd>
									{formatMillimetres(model.dimensions.x)} ×
									{formatMillimetres(model.dimensions.y)} ×
									{formatMillimetres(model.dimensions.z)} mm
								</dd>
							</div>
							<div>
								<dt>Triangles</dt>
								<dd>{model.triangleCount.toLocaleString()}</dd>
							</div>
							<div>
								<dt>Encoding</dt>
								<dd>{model.format}</dd>
							</div>
							<div>
								<dt>File size</dt>
								<dd>{formatFileSize(model.byteLength)}</dd>
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
	.topbar {
		display: grid;
		grid-template-columns: 1fr auto 1fr;
		align-items: center;
		height: 68px;
		padding: 0 22px;
		border-bottom: 1px solid #1c2634;
		background: rgba(12, 18, 26, 0.88);
		backdrop-filter: blur(16px);
	}
	.brand {
		display: inline-flex;
		align-items: center;
		gap: 10px;
		width: fit-content;
		color: #f1f6fc;
		font-size: 16px;
		font-weight: 650;
		letter-spacing: -0.02em;
		text-decoration: none;
	}
	.brand > span:last-child span {
		color: #6bb8ff;
	}
	.brand-mark {
		display: grid;
		width: 32px;
		height: 32px;
		place-items: center;
		border: 1px solid #27527a;
		border-radius: 9px;
		background: linear-gradient(145deg, #18324a, #101c29);
		box-shadow: 0 7px 22px rgba(0, 0, 0, 0.3);
	}
	.brand-mark svg {
		width: 20px;
		fill: rgba(107, 184, 255, 0.08);
		stroke: #74bfff;
		stroke-linejoin: round;
		stroke-width: 1.4;
	}
	.workflow {
		display: flex;
		align-items: center;
		gap: 12px;
	}
	.workflow-step {
		display: flex;
		align-items: center;
		gap: 7px;
		color: #637083;
		font-size: 11px;
		font-weight: 600;
		letter-spacing: 0.03em;
		text-transform: uppercase;
	}
	.workflow-step b {
		display: grid;
		width: 19px;
		height: 19px;
		place-items: center;
		border: 1px solid #293548;
		border-radius: 50%;
		font-size: 9px;
	}
	.workflow-step.active {
		color: #bddcf8;
	}
	.workflow-step.active b {
		border-color: #3d7bac;
		background: #16334a;
		color: #82c6ff;
	}
	.workflow-divider {
		width: 24px;
		height: 1px;
		background: #273244;
	}
	.topbar-actions {
		display: flex;
		justify-content: flex-end;
		align-items: center;
		gap: 14px;
	}
	.local-badge {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		color: #728298;
		font-size: 11px;
	}
	.local-badge svg {
		width: 14px;
		fill: none;
		stroke: currentColor;
		stroke-width: 1.2;
	}
	.open-button {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		height: 36px;
		padding: 0 14px;
		border: 1px solid #356b96;
		border-radius: 8px;
		background: linear-gradient(#214968, #1a3d58);
		box-shadow:
			inset 0 1px rgba(255, 255, 255, 0.08),
			0 4px 14px rgba(0, 0, 0, 0.18);
		color: #d7ecff;
		cursor: pointer;
		font-size: 12px;
		font-weight: 600;
	}
	.file-input {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip-path: inset(50%);
		white-space: nowrap;
	}
	.open-button.disabled {
		cursor: wait;
		opacity: 0.7;
	}
	.open-button svg {
		width: 16px;
		fill: none;
		stroke: currentColor;
		stroke-linecap: round;
		stroke-linejoin: round;
		stroke-width: 1.5;
	}
	.workspace {
		display: grid;
		grid-template-columns: minmax(0, 1fr) 288px;
		height: calc(100vh - 68px);
		min-height: 560px;
	}
	.viewport-panel {
		display: grid;
		grid-template-rows: auto minmax(0, 1fr);
		min-width: 0;
		padding: 22px;
	}
	.viewport-heading,
	.section-heading {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
	}
	.viewport-heading {
		align-items: center;
		padding: 0 2px 15px;
	}
	.eyebrow {
		margin: 0 0 4px;
		color: #65768d;
		font-size: 9px;
		font-weight: 700;
		letter-spacing: 0.14em;
		text-transform: uppercase;
	}
	h1,
	h2 {
		margin: 0;
		font-weight: 600;
		letter-spacing: -0.02em;
	}
	h1 {
		font-size: 17px;
	}
	h2 {
		font-size: 14px;
	}
	.view-chip,
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
	.view-chip span {
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: #67baff;
		box-shadow: 0 0 8px rgba(103, 186, 255, 0.65);
	}
	.viewport-canvas {
		position: relative;
		min-height: 0;
		overflow: hidden;
		border: 1px solid #202c3b;
		border-radius: 12px;
		background:
			radial-gradient(circle at 50% 48%, rgba(35, 54, 76, 0.21), transparent 28rem),
			linear-gradient(180deg, #0e151f 0%, #0b1119 100%);
		box-shadow:
			inset 0 1px rgba(255, 255, 255, 0.025),
			0 16px 50px rgba(0, 0, 0, 0.14);
	}
	.viewport-canvas::before {
		position: absolute;
		inset: 0;
		background-image: radial-gradient(rgba(131, 157, 186, 0.08) 0.65px, transparent 0.65px);
		background-size: 16px 16px;
		content: '';
		mask-image: radial-gradient(circle at center, black, transparent 74%);
		pointer-events: none;
	}
	canvas {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		cursor: default;
		touch-action: none;
	}
	.viewport-canvas.orbiting canvas {
		cursor: grabbing;
	}
	.axis-legend {
		position: absolute;
		top: 16px;
		left: 16px;
		display: flex;
		gap: 8px;
	}
	.axis-legend > span {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		padding: 5px 7px;
		border: 1px solid rgba(74, 92, 115, 0.36);
		border-radius: 6px;
		background: rgba(13, 20, 29, 0.72);
		backdrop-filter: blur(8px);
		font-size: 9px;
		font-weight: 700;
	}
	.axis-legend i {
		width: 5px;
		height: 5px;
		border-radius: 50%;
		background: currentColor;
		box-shadow: 0 0 5px currentColor;
	}
	.axis-legend small {
		color: #6f7f93;
		font-size: 9px;
		font-weight: 500;
	}
	.axis-x {
		color: #ff777b;
	}
	.axis-y {
		color: #72e7ac;
	}
	.axis-z {
		color: #75bdff;
	}
	.coordinate-note {
		position: absolute;
		top: 16px;
		right: 16px;
		display: flex;
		align-items: center;
		gap: 7px;
		padding: 6px 9px;
		border: 1px solid rgba(74, 92, 115, 0.3);
		border-radius: 6px;
		background: rgba(13, 20, 29, 0.68);
		color: #718096;
		font-size: 9px;
	}
	.coordinate-note svg {
		width: 13px;
		fill: none;
		stroke: #6a9bc3;
		stroke-linecap: round;
		stroke-width: 1.2;
	}
	.orbit-hint {
		position: absolute;
		bottom: 17px;
		left: 50%;
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 7px 10px;
		transform: translateX(-50%);
		border: 1px solid rgba(68, 84, 105, 0.45);
		border-radius: 7px;
		background: rgba(10, 16, 24, 0.78);
		color: #7d8b9d;
		font-size: 10px;
		transition:
			border-color 120ms ease,
			color 120ms ease;
		pointer-events: none;
	}
	.orbit-hint.active {
		border-color: rgba(90, 168, 228, 0.55);
		color: #a8d9ff;
	}
	.volume-warning {
		position: absolute;
		right: 17px;
		bottom: 17px;
		display: flex;
		align-items: center;
		gap: 10px;
		max-width: 260px;
		padding: 9px 11px;
		border: 1px solid rgba(255, 200, 74, 0.48);
		border-radius: 8px;
		background: rgba(49, 38, 13, 0.88);
		box-shadow:
			0 8px 24px rgba(0, 0, 0, 0.24),
			inset 0 1px rgba(255, 226, 154, 0.06);
		color: #ffc84a;
		backdrop-filter: blur(8px);
		pointer-events: none;
	}
	.volume-warning svg {
		width: 22px;
		flex: 0 0 auto;
		fill: rgba(255, 200, 74, 0.1);
		stroke: currentColor;
		stroke-linecap: round;
		stroke-linejoin: round;
		stroke-width: 1.6;
	}
	.volume-warning div {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.volume-warning strong {
		font-size: 10px;
		font-weight: 700;
		letter-spacing: 0.02em;
		text-transform: uppercase;
	}
	.volume-warning span {
		color: #d8b867;
		font-size: 9px;
		line-height: 1.35;
	}
	.mouse-icon {
		position: relative;
		display: inline-block;
		width: 12px;
		height: 17px;
		border: 1px solid currentColor;
		border-radius: 7px;
	}
	.mouse-icon i {
		position: absolute;
		top: 2px;
		left: 50%;
		width: 2px;
		height: 5px;
		transform: translateX(-50%);
		border-radius: 2px;
		background: currentColor;
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
	.model-position {
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
	.model-position span {
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: #67c1f6;
		box-shadow: 0 0 6px rgba(103, 193, 246, 0.75);
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
		.workflow,
		.local-badge,
		.coordinate-note {
			display: none;
		}
		.topbar {
			grid-template-columns: 1fr auto;
		}
		.workspace {
			grid-template-columns: 1fr;
			height: calc(100vh - 68px);
		}
		.properties {
			display: none;
		}
	}
	@media (max-width: 520px) {
		.topbar {
			padding: 0 14px;
		}
		.viewport-panel {
			padding: 14px;
		}
		.axis-legend small {
			display: none;
		}
		.volume-warning {
			right: 12px;
			bottom: 54px;
			max-width: calc(100% - 24px);
		}
	}
</style>
