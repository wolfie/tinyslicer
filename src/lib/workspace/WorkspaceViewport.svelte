<script lang="ts">
	import { TINYMAKER_PROFILE } from '$lib/printer/tinymaker';
	import { SUPPORT_RISK_ANGLE_DEGREES } from './support-risk';
	import {
		firstBuildVolumeOverflowDirection,
		initializeBuildVolume,
		paintBuildVolume,
		pickModelSurface,
		ROTATION_SNAP_DEGREES,
		startModelTransform,
		stopModelTransform,
		updateModelTransform,
		type BuildVolumeInteractionMode,
		type ModelInteraction,
		type ModelRotation,
		type ModelTranslation
	} from './build-volume-renderer';
	import { CanvasMetrics } from './canvas-metrics.svelte';
	import { OrbitCamera } from './orbit-camera.svelte';
	import type { Bounds3, ImportedStlModel } from './stl-importer';
	import type { ModelSurfaceHit, SupportPoint, SupportStructure } from './supports';

	type Props = {
		model: ImportedStlModel | null;
		modelTranslation: ModelTranslation;
		modelRotation: ModelRotation;
		transformedModelBounds: Bounds3 | null;
		modelOutsideBuildVolume: boolean;
		modelOverlapsSupportMargin: boolean;
		canEnterSupports: boolean;
		interactionMode: BuildVolumeInteractionMode;
		supportPointCount: number;
		supportPoints: readonly SupportPoint[];
		supportStructures: readonly SupportStructure[];
		onTranslationChange: (translation: ModelTranslation) => void;
		onRotationChange: (rotation: ModelRotation) => void;
		onSupportPointPlaced: (hit: ModelSurfaceHit) => void;
		onEnterSupports: () => void;
		onBackToPrepare: () => void;
	};

	let {
		model,
		modelTranslation,
		modelRotation,
		transformedModelBounds,
		modelOutsideBuildVolume,
		modelOverlapsSupportMargin,
		canEnterSupports,
		interactionMode,
		supportPointCount,
		supportPoints,
		supportStructures,
		onTranslationChange,
		onRotationChange,
		onSupportPointPlaced,
		onEnterSupports,
		onBackToPrepare
	}: Props = $props();

	const camera = new OrbitCamera();
	const canvasMetrics = new CanvasMetrics();
	let modelInteraction = $state<ModelInteraction | null>(null);
	let placingSupports = $derived(interactionMode === 'place-supports');

	function focusFirstClippedRegion() {
		if (!transformedModelBounds) return;
		const direction = firstBuildVolumeOverflowDirection(transformedModelBounds);
		if (direction) camera.orbitToward(direction);
	}

	function handlePointerDown(event: PointerEvent) {
		if (placingSupports && event.button === 0) {
			const hit = pickModelSurface(event);
			if (hit) {
				event.preventDefault();
				onSupportPointPlaced(hit);
			}
			return;
		}

		if (
			interactionMode === 'transform-model' &&
			model &&
			startModelTransform(
				event,
				modelTranslation,
				modelRotation,
				onTranslationChange,
				onRotationChange,
				(interaction) => {
					modelInteraction = interaction;
				}
			)
		) {
			return;
		}
		camera.start(event);
	}

	function handlePointerMove(event: PointerEvent) {
		if (interactionMode === 'transform-model' && updateModelTransform(event)) return;
		camera.update(event);
	}

	function handlePointerEnd(event: PointerEvent) {
		if (interactionMode === 'transform-model' && stopModelTransform(event)) return;
		camera.stop(event);
	}
</script>

<section class="viewport-panel" aria-label="3D printer build volume">
	<div class="viewport-heading">
		<div>
			<p class="eyebrow">3D workspace</p>
			<h1>{placingSupports ? 'Place supports' : 'Build volume'}</h1>
		</div>
		{#if placingSupports}
			<button type="button" class="back-button" onclick={onBackToPrepare}>
				<svg viewBox="0 0 18 18" aria-hidden="true"><path d="m11.5 4-5 5 5 5" /></svg>
				Back to Prepare
			</button>
		{:else}
			<div class="view-chip"><span></span> Perspective</div>
		{/if}
	</div>
	<div
		class={[
			'viewport-canvas',
			{
				orbiting: camera.orbiting,
				translating: modelInteraction?.kind === 'translation',
				rotating: modelInteraction?.kind === 'rotation',
				'placing-supports': placingSupports
			}
		]}
	>
		<canvas
			{@attach canvasMetrics.observe}
			{@attach initializeBuildVolume}
			{@attach paintBuildVolume({
				cameraYaw: camera.yaw,
				cameraPitch: camera.pitch,
				width: canvasMetrics.width,
				height: canvasMetrics.height,
				dpr: canvasMetrics.dpr,
				model,
				modelTranslation,
				modelRotation,
				interactionMode,
				supportPoints,
				supportStructures
			})}
			onpointerdown={handlePointerDown}
			onpointermove={handlePointerMove}
			onpointerup={handlePointerEnd}
			onpointercancel={handlePointerEnd}
			onauxclick={(event) => event.preventDefault()}
			aria-label={`Interactive 3D view of the ${TINYMAKER_PROFILE.buildVolume.x} by ${TINYMAKER_PROFILE.buildVolume.y} by ${TINYMAKER_PROFILE.buildVolume.z} millimetre ${TINYMAKER_PROFILE.name} build volume${model ? ` containing ${model.name}` : ''}. ${placingSupports ? 'Click the model to place a support point. ' : model ? `Drag the model to move it, click an arrow to nudge it, or drag a colored ring to rotate it in ${ROTATION_SNAP_DEGREES} degree steps. ` : ''}Drag with the middle mouse button to orbit.`}
		></canvas>
		<div class="axis-legend" aria-label="Axis directions">
			<span class="axis-x"><i></i>X <small>{TINYMAKER_PROFILE.buildVolume.x} mm</small></span>
			<span class="axis-y"><i></i>Y <small>{TINYMAKER_PROFILE.buildVolume.y} mm</small></span>
			<span class="axis-z"><i></i>Z <small>{TINYMAKER_PROFILE.buildVolume.z} mm</small></span>
		</div>
		<div class="coordinate-note">
			<svg viewBox="0 0 18 18" aria-hidden="true">
				<circle cx="9" cy="9" r="7" /><path d="M9 8v4m0-7v.1" />
			</svg>
			X/Y origin is the upper-left of the layer image · Z=0 is the build plate
		</div>
		{#if placingSupports && model}
			<div
				class="support-risk-legend"
				role="status"
				title="Fast surface-angle estimate. Layer-mask island analysis may identify additional areas."
			>
				<span></span>
				Yellow faces may need support · {SUPPORT_RISK_ANGLE_DEGREES}° preview
			</div>
		{/if}
		<div class={['orbit-hint', { active: camera.orbiting || modelInteraction !== null }]}>
			<span class="mouse-icon" aria-hidden="true"><i></i></span>
			<span>
				{modelInteraction?.kind === 'rotation'
					? `Rotating ${modelInteraction.axis.toUpperCase()} · ${ROTATION_SNAP_DEGREES}° snap · Hold Shift for free`
					: modelInteraction?.kind === 'translation'
						? 'Moving model'
						: camera.orbiting
							? 'Orbiting view'
							: placingSupports
								? 'Click model to place · Middle-drag to orbit'
								: model
									? `Drag rings to rotate · ${ROTATION_SNAP_DEGREES}° snap · Shift for free`
									: 'Middle-drag to orbit'}
			</span>
		</div>
		{#if modelOutsideBuildVolume || (interactionMode === 'transform-model' && canEnterSupports)}
			<div class="viewport-actions">
				{#if modelOutsideBuildVolume}
					<button
						type="button"
						class="volume-warning"
						onclick={focusFirstClippedRegion}
						aria-live="assertive"
						aria-label="Outside print volume. Show the first area beyond the printable volume."
					>
						<svg viewBox="0 0 24 24" aria-hidden="true">
							<path d="M12 3 22 20H2L12 3Z" />
							<path d="M12 9v5m0 3v.1" />
						</svg>
						<div>
							<strong>Outside print volume</strong>
							<span>Click to inspect the first clipped area.</span>
						</div>
					</button>
				{:else}
					{#if modelOverlapsSupportMargin}
						<div class="support-margin-info" role="status">
							<svg viewBox="0 0 24 24" aria-hidden="true">
								<circle cx="12" cy="12" r="9" />
								<path d="M12 11v5m0-8v.1" />
							</svg>
							<div>
								<strong>Limited support area</strong>
								<span>Parts of the model are too close to the edge for supports.</span>
							</div>
						</div>
					{/if}
					<button type="button" class="supports-button" onclick={onEnterSupports}>
						<svg viewBox="0 0 24 24" aria-hidden="true">
							<circle cx="8" cy="8" r="2.5" /><path d="M8 10.5V20m8-13v13M4 20h16" />
							<circle cx="16" cy="4.5" r="2.5" />
						</svg>
						<div>
							<strong>Add supports</strong>
							<span>Model placement is ready.</span>
						</div>
					</button>
				{/if}
			</div>
		{/if}
		{#if placingSupports}
			<p class="support-count" aria-live="polite">
				<span></span>{supportPointCount} support {supportPointCount === 1 ? 'point' : 'points'} placed
			</p>
		{/if}
	</div>
</section>

<style>
	.viewport-panel {
		display: grid;
		grid-template-rows: auto minmax(0, 1fr);
		min-width: 0;
		padding: 22px;
	}
	.viewport-heading {
		display: flex;
		align-items: center;
		justify-content: space-between;
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
	h1 {
		margin: 0;
		font-size: 17px;
		font-weight: 600;
		letter-spacing: -0.02em;
	}
	.view-chip,
	.back-button {
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
	.back-button {
		border-color: rgba(87, 220, 139, 0.3);
		color: #9edeb7;
		cursor: pointer;
	}
	.back-button:hover {
		background: rgba(29, 74, 47, 0.35);
	}
	.back-button:focus-visible {
		outline: 2px solid #65d899;
		outline-offset: 2px;
	}
	.back-button svg {
		width: 14px;
		fill: none;
		stroke: currentColor;
		stroke-linecap: round;
		stroke-linejoin: round;
		stroke-width: 1.6;
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
	.viewport-canvas.placing-supports canvas {
		cursor: crosshair;
	}
	.viewport-canvas.orbiting canvas,
	.viewport-canvas.translating canvas,
	.viewport-canvas.rotating canvas {
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
	.support-risk-legend {
		position: absolute;
		top: 52px;
		right: 16px;
		display: flex;
		align-items: center;
		gap: 7px;
		padding: 6px 9px;
		border: 1px solid rgba(255, 211, 79, 0.35);
		border-radius: 6px;
		background: rgba(45, 36, 12, 0.78);
		color: #e6c65f;
		font-size: 9px;
		pointer-events: none;
	}
	.support-risk-legend span {
		width: 7px;
		height: 7px;
		border-radius: 2px;
		background: #ffd34f;
		box-shadow: 0 0 7px rgba(255, 211, 79, 0.55);
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
	.viewport-actions {
		position: absolute;
		right: 17px;
		bottom: 17px;
		display: flex;
		width: min(280px, calc(100% - 34px));
		flex-direction: column;
		gap: 8px;
	}
	.volume-warning,
	.support-margin-info,
	.supports-button {
		display: flex;
		align-items: center;
		gap: 10px;
		width: 100%;
		padding: 9px 11px;
		border-radius: 8px;
		box-shadow:
			0 8px 24px rgba(0, 0, 0, 0.24),
			inset 0 1px rgba(255, 255, 255, 0.06);
		backdrop-filter: blur(8px);
		text-align: left;
		transition:
			border-color 120ms ease,
			background 120ms ease,
			box-shadow 120ms ease;
	}
	.volume-warning {
		border: 1px solid rgba(255, 200, 74, 0.48);
		background: rgba(49, 38, 13, 0.88);
		color: #ffc84a;
		cursor: pointer;
	}
	.volume-warning:hover {
		border-color: rgba(255, 210, 92, 0.72);
		background: rgba(63, 48, 16, 0.94);
	}
	.volume-warning:focus-visible {
		outline: 2px solid #ffd46d;
		outline-offset: 3px;
	}
	.supports-button {
		border: 1px solid rgba(87, 220, 139, 0.48);
		background: rgba(18, 61, 37, 0.9);
		color: #70e6a1;
		cursor: pointer;
	}
	.support-margin-info {
		border: 1px solid rgba(164, 174, 188, 0.38);
		background: rgba(38, 45, 55, 0.9);
		color: #b5beca;
	}
	.supports-button:hover {
		border-color: rgba(112, 230, 161, 0.76);
		background: rgba(21, 77, 45, 0.96);
		box-shadow:
			0 8px 28px rgba(0, 0, 0, 0.28),
			0 0 18px rgba(87, 220, 139, 0.08);
	}
	.supports-button:focus-visible {
		outline: 2px solid #70e6a1;
		outline-offset: 3px;
	}
	.volume-warning svg,
	.support-margin-info svg,
	.supports-button svg {
		width: 22px;
		flex: 0 0 auto;
		fill: rgba(255, 255, 255, 0.06);
		stroke: currentColor;
		stroke-linecap: round;
		stroke-linejoin: round;
		stroke-width: 1.6;
	}
	.volume-warning div,
	.support-margin-info div,
	.supports-button div {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.volume-warning strong,
	.support-margin-info strong,
	.supports-button strong {
		font-size: 10px;
		font-weight: 700;
		letter-spacing: 0.02em;
		text-transform: uppercase;
	}
	.volume-warning span,
	.support-margin-info span,
	.supports-button span {
		font-size: 9px;
		line-height: 1.35;
	}
	.volume-warning span {
		color: #d8b867;
	}
	.support-margin-info span {
		color: #929daa;
	}
	.supports-button span {
		color: #8ecba7;
	}
	.support-count {
		position: absolute;
		right: 17px;
		bottom: 17px;
		display: flex;
		align-items: center;
		gap: 7px;
		margin: 0;
		padding: 7px 9px;
		border: 1px solid rgba(87, 220, 139, 0.28);
		border-radius: 7px;
		background: rgba(11, 35, 23, 0.82);
		color: #8ed9ab;
		font-size: 9px;
		font-weight: 600;
		pointer-events: none;
	}
	.support-count span {
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: #57dc8b;
		box-shadow: 0 0 7px rgba(87, 220, 139, 0.72);
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
	@media (max-width: 820px) {
		.coordinate-note {
			display: none;
		}
		.support-risk-legend {
			top: 16px;
		}
	}
	@media (max-width: 520px) {
		.viewport-panel {
			padding: 14px;
		}
		.axis-legend small {
			display: none;
		}
		.viewport-actions {
			right: 12px;
			bottom: 54px;
			width: calc(100% - 24px);
		}
		.support-count {
			right: 12px;
			bottom: 54px;
		}
	}
</style>
