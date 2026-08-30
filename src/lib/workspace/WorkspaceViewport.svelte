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
	import type { RaftIsland } from '$lib/supports/raft-plan';
	import type { AutoSupportBuildStatus } from './auto-support-state.svelte';
	import type { PreviewBuildStatus, PreviewMeshData } from './preview-state.svelte';

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
		raftIslands: readonly RaftIsland[];
		autoSupportStatus: AutoSupportBuildStatus;
		autoSupportProgress: number;
		previewStatus: PreviewBuildStatus;
		previewProgress: number;
		previewMesh: PreviewMeshData | null;
		previewLayerCount: number;
		previewZHeightMm: number;
		previewWatertight: boolean;
		previewError: string | null;
		onTranslationChange: (translation: ModelTranslation) => void;
		onRotationChange: (rotation: ModelRotation) => void;
		onSupportPointPlaced: (hit: ModelSurfaceHit) => void;
		onEnterSupports: () => void;
		onEnterPreview: () => void;
		onBackToPrepare: () => void;
		onBackToSupports: () => void;
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
		raftIslands,
		autoSupportStatus,
		autoSupportProgress,
		previewStatus,
		previewProgress,
		previewMesh,
		previewLayerCount,
		previewZHeightMm,
		previewWatertight,
		previewError,
		onTranslationChange,
		onRotationChange,
		onSupportPointPlaced,
		onEnterSupports,
		onEnterPreview,
		onBackToPrepare,
		onBackToSupports
	}: Props = $props();

	const camera = new OrbitCamera();
	const canvasMetrics = new CanvasMetrics();
	let modelInteraction = $state<ModelInteraction | null>(null);
	let placingSupports = $derived(interactionMode === 'place-supports');
	let previewing = $derived(interactionMode === 'readonly');
	let previewPercent = $derived(Math.round(previewProgress * 100));
	let autoSupportPercent = $derived(Math.round(autoSupportProgress * 100));
	let generatingSupports = $derived(placingSupports && autoSupportStatus === 'building');
	let orbitHintActive = $derived(camera.orbiting || modelInteraction !== null);
	let canvasCursorClass = $derived(
		camera.orbiting || modelInteraction !== null
			? 'cursor-grabbing'
			: generatingSupports
				? 'cursor-progress'
				: placingSupports
					? 'cursor-crosshair'
					: 'cursor-default'
	);

	const BACK_BUTTON_CLASS =
		'u-chip cursor-pointer border-green/30 text-[#9edeb7] hover:bg-[rgba(29,74,47,0.35)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#65d899] [&_svg]:w-3.5';
	const HUD_TAG =
		'absolute flex items-center gap-[7px] rounded-md border px-[9px] py-1.5 text-[9px]';
	const ACTION_BOX =
		'flex w-full items-center gap-2.5 rounded-lg px-[11px] py-[9px] text-left shadow-[0_8px_24px_rgba(0,0,0,0.24),inset_0_1px_rgba(255,255,255,0.06)] backdrop-blur-[8px] transition-[border-color,background,box-shadow] duration-[120ms]';
	const ACTION_ICON =
		'w-[22px] shrink-0 fill-[rgba(255,255,255,0.06)] stroke-current [stroke-linecap:round] [stroke-linejoin:round] [stroke-width:1.6]';
	const ACTION_TITLE = 'text-[10px] font-bold uppercase tracking-[0.02em]';
	const ACTION_DESC = 'flex flex-col gap-0.5';
	const GREEN_ACTION_BUTTON = `${ACTION_BOX} cursor-pointer border border-green/48 bg-[rgba(18,61,37,0.9)] text-[#70e6a1] hover:border-[rgba(112,230,161,0.76)] hover:bg-[rgba(21,77,45,0.96)] hover:shadow-[0_8px_28px_rgba(0,0,0,0.28),0_0_18px_rgba(87,220,139,0.08)] focus-visible:outline-2 focus-visible:outline-offset-[3px] focus-visible:outline-[#70e6a1]`;
	const CORNER_ACTION_STACK =
		'absolute right-[17px] bottom-[17px] flex w-[min(280px,calc(100%_-_34px))] flex-col gap-2 max-mobile:right-3 max-mobile:bottom-[54px] max-mobile:w-[calc(100%_-_24px)]';
	const PREVIEW_STATUS_BASE =
		'pointer-events-none absolute right-[17px] bottom-[17px] flex w-[min(300px,calc(100%_-_34px))] flex-col gap-[5px] rounded-lg border px-[11px] py-[9px] text-[10px] font-semibold backdrop-blur-[8px] max-mobile:right-3';

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

<section
	class="grid min-w-0 grid-rows-[auto_minmax(0,1fr)] p-[22px] max-mobile:p-[14px]"
	aria-label="3D printer build volume"
>
	<div class="flex items-center justify-between px-0.5 pb-[15px]">
		<div>
			<p class="u-eyebrow mb-1">3D workspace</p>
			<h1 class="m-0 text-[17px] font-semibold tracking-[-0.02em]">
				{previewing ? 'Sliced preview' : placingSupports ? 'Place supports' : 'Build volume'}
			</h1>
		</div>
		{#if placingSupports}
			<button type="button" class={BACK_BUTTON_CLASS} onclick={onBackToPrepare}>
				<svg class="u-icon [stroke-width:1.6]" viewBox="0 0 18 18" aria-hidden="true"
					><path d="m11.5 4-5 5 5 5" /></svg
				>
				Back to Prepare
			</button>
		{:else if previewing}
			<button type="button" class={BACK_BUTTON_CLASS} onclick={onBackToSupports}>
				<svg class="u-icon [stroke-width:1.6]" viewBox="0 0 18 18" aria-hidden="true"
					><path d="m11.5 4-5 5 5 5" /></svg
				>
				Back to Supports
			</button>
		{:else}
			<div class="u-chip"><span class="u-dot text-blue"></span> Perspective</div>
		{/if}
	</div>
	<div
		class="viewport-canvas relative min-h-0 overflow-hidden rounded-xl border border-[#202c3b] bg-[radial-gradient(circle_at_50%_48%,rgba(35,54,76,0.21),transparent_28rem),linear-gradient(180deg,#0e151f_0%,#0b1119_100%)] shadow-[inset_0_1px_rgba(255,255,255,0.025),0_16px_50px_rgba(0,0,0,0.14)]"
	>
		<canvas
			class={['absolute inset-0 h-full w-full touch-none', canvasCursorClass]}
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
				supportStructures,
				raftIslands,
				previewMesh: previewStatus === 'ready' ? previewMesh : null
			})}
			onpointerdown={handlePointerDown}
			onpointermove={handlePointerMove}
			onpointerup={handlePointerEnd}
			onpointercancel={handlePointerEnd}
			onauxclick={(event) => event.preventDefault()}
			aria-label={`Interactive 3D view of the ${TINYMAKER_PROFILE.buildVolume.x} by ${TINYMAKER_PROFILE.buildVolume.y} by ${TINYMAKER_PROFILE.buildVolume.z} millimetre ${TINYMAKER_PROFILE.name} build volume${model ? ` containing ${model.name}` : ''}. ${placingSupports ? 'Click the model to place a support point. ' : model ? `Drag the model to move it, click an arrow to nudge it, or drag a colored ring to rotate it in ${ROTATION_SNAP_DEGREES} degree steps. ` : ''}Drag with the middle mouse button to orbit.`}
		></canvas>
		<div class="absolute top-4 left-4 flex gap-2" aria-label="Axis directions">
			<span
				class="inline-flex items-center gap-[5px] rounded-md border border-[rgba(74,92,115,0.36)] bg-[rgba(13,20,29,0.72)] px-[7px] py-[5px] text-[9px] font-bold text-axis-x backdrop-blur-[8px]"
				><i class="size-[5px] rounded-full bg-current shadow-[0_0_5px_currentColor]"></i>X
				<small class="text-[9px] font-medium text-[#6f7f93] max-mobile:hidden"
					>{TINYMAKER_PROFILE.buildVolume.x} mm</small
				></span
			>
			<span
				class="inline-flex items-center gap-[5px] rounded-md border border-[rgba(74,92,115,0.36)] bg-[rgba(13,20,29,0.72)] px-[7px] py-[5px] text-[9px] font-bold text-axis-y backdrop-blur-[8px]"
				><i class="size-[5px] rounded-full bg-current shadow-[0_0_5px_currentColor]"></i>Y
				<small class="text-[9px] font-medium text-[#6f7f93] max-mobile:hidden"
					>{TINYMAKER_PROFILE.buildVolume.y} mm</small
				></span
			>
			<span
				class="inline-flex items-center gap-[5px] rounded-md border border-[rgba(74,92,115,0.36)] bg-[rgba(13,20,29,0.72)] px-[7px] py-[5px] text-[9px] font-bold text-axis-z backdrop-blur-[8px]"
				><i class="size-[5px] rounded-full bg-current shadow-[0_0_5px_currentColor]"></i>Z
				<small class="text-[9px] font-medium text-[#6f7f93] max-mobile:hidden"
					>{TINYMAKER_PROFILE.buildVolume.z} mm</small
				></span
			>
		</div>
		<div
			class="{HUD_TAG} top-4 right-4 border-[rgba(74,92,115,0.3)] bg-[rgba(13,20,29,0.68)] text-[#718096] max-tablet:hidden"
		>
			<svg
				class="u-icon w-[13px] stroke-[#6a9bc3] [stroke-width:1.2]"
				viewBox="0 0 18 18"
				aria-hidden="true"
			>
				<circle cx="9" cy="9" r="7" /><path d="M9 8v4m0-7v.1" />
			</svg>
			X/Y origin is the upper-left of the layer image · Z=0 is the build plate
		</div>
		{#if placingSupports && model}
			<div
				class="{HUD_TAG} pointer-events-none top-[52px] right-4 border-[rgba(255,211,79,0.35)] bg-[rgba(45,36,12,0.78)] text-amber-soft max-tablet:top-4"
				role="status"
				title="Fast surface-angle estimate. Layer-mask island analysis may identify additional areas."
			>
				<span class="size-[7px] rounded-[2px] bg-[#ffd34f] shadow-[0_0_7px_rgba(255,211,79,0.55)]"
				></span>
				Yellow faces may need support · {SUPPORT_RISK_ANGLE_DEGREES}° preview
			</div>
		{/if}
		<div
			class={[
				'pointer-events-none absolute bottom-[17px] left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-[7px] border bg-[rgba(10,16,24,0.78)] px-2.5 py-[7px] text-[10px] transition-[border-color,color] duration-[120ms]',
				orbitHintActive
					? 'border-[rgba(90,168,228,0.55)] text-blue-bright'
					: 'border-[rgba(68,84,105,0.45)] text-[#7d8b9d]'
			]}
		>
			<span
				class="relative inline-block h-[17px] w-3 rounded-[7px] border border-current"
				aria-hidden="true"
				><i
					class="absolute top-0.5 left-1/2 h-[5px] w-0.5 -translate-x-1/2 rounded-[2px] bg-current"
				></i></span
			>
			<span>
				{modelInteraction?.kind === 'rotation'
					? `Rotating ${modelInteraction.axis.toUpperCase()} · ${ROTATION_SNAP_DEGREES}° snap · Hold Shift for free`
					: modelInteraction?.kind === 'translation'
						? 'Moving model'
						: camera.orbiting
							? 'Orbiting view'
							: previewing
								? 'Preview is read-only · Drag to orbit'
								: generatingSupports
									? 'Generating initial supports · Middle-drag to orbit'
									: placingSupports
										? 'Click model to place · Middle-drag to orbit'
										: model
											? `Drag rings to rotate · ${ROTATION_SNAP_DEGREES}° snap · Shift for free`
											: 'Middle-drag to orbit'}
			</span>
		</div>
		{#if modelOutsideBuildVolume || (interactionMode === 'transform-model' && canEnterSupports)}
			<div class={CORNER_ACTION_STACK}>
				{#if modelOutsideBuildVolume}
					<button
						type="button"
						class="{ACTION_BOX} cursor-pointer border border-amber/48 bg-[rgba(49,38,13,0.88)] text-amber hover:border-[rgba(255,210,92,0.72)] hover:bg-[rgba(63,48,16,0.94)] focus-visible:outline-2 focus-visible:outline-offset-[3px] focus-visible:outline-[#ffd46d]"
						onclick={focusFirstClippedRegion}
						aria-live="assertive"
						aria-label="Outside print volume. Show the first area beyond the printable volume."
					>
						<svg class={ACTION_ICON} viewBox="0 0 24 24" aria-hidden="true">
							<path d="M12 3 22 20H2L12 3Z" />
							<path d="M12 9v5m0 3v.1" />
						</svg>
						<div class={ACTION_DESC}>
							<strong class={ACTION_TITLE}>Outside print volume</strong>
							<span class="text-[9px] leading-[1.35] text-[#d8b867]"
								>Click to inspect the first clipped area.</span
							>
						</div>
					</button>
				{:else}
					{#if modelOverlapsSupportMargin}
						<div
							class="{ACTION_BOX} border border-[rgba(164,174,188,0.38)] bg-[rgba(38,45,55,0.9)] text-[#b5beca]"
							role="status"
						>
							<svg class={ACTION_ICON} viewBox="0 0 24 24" aria-hidden="true">
								<circle cx="12" cy="12" r="9" />
								<path d="M12 11v5m0-8v.1" />
							</svg>
							<div class={ACTION_DESC}>
								<strong class={ACTION_TITLE}>Limited support area</strong>
								<span class="text-[9px] leading-[1.35] text-[#929daa]"
									>Parts of the model are too close to the edge for supports.</span
								>
							</div>
						</div>
					{/if}
					<button type="button" class={GREEN_ACTION_BUTTON} onclick={onEnterSupports}>
						<svg class={ACTION_ICON} viewBox="0 0 24 24" aria-hidden="true">
							<circle cx="8" cy="8" r="2.5" /><path d="M8 10.5V20m8-13v13M4 20h16" />
							<circle cx="16" cy="4.5" r="2.5" />
						</svg>
						<div class={ACTION_DESC}>
							<strong class={ACTION_TITLE}>Add supports</strong>
							<span class="text-[9px] leading-[1.35] text-[#8ecba7]">Model placement is ready.</span
							>
						</div>
					</button>
				{/if}
			</div>
		{/if}
		{#if placingSupports}
			{#if autoSupportStatus === 'building'}
				<div
					class="{PREVIEW_STATUS_BASE} border-[rgba(120,150,185,0.32)] bg-[rgba(12,20,30,0.86)] text-[#9fb2c6]"
					role="status"
					aria-live="polite"
				>
					<div class="h-1 w-full overflow-hidden rounded-full bg-[rgba(120,150,185,0.22)]">
						<div
							class="h-full rounded-full bg-[linear-gradient(90deg,#4d9fd6,#7ad0ff)] transition-[width] duration-[160ms]"
							style:width={`${autoSupportPercent}%`}
						></div>
					</div>
					<span>Generating initial supports · {autoSupportPercent}%</span>
				</div>
			{:else}
				<div class={CORNER_ACTION_STACK}>
					<p
						class="pointer-events-none m-0 flex items-center gap-[7px] self-end rounded-[7px] border border-green/30 bg-[rgba(11,35,23,0.82)] px-[9px] py-[7px] text-[9px] font-semibold text-green-soft"
						aria-live="polite"
					>
						<span class="u-dot text-green"></span>{supportPointCount} support {supportPointCount ===
						1
							? 'point'
							: 'points'} placed
					</p>
					{#if canEnterSupports}
						<button type="button" class={GREEN_ACTION_BUTTON} onclick={onEnterPreview}>
							<svg class={ACTION_ICON} viewBox="0 0 24 24" aria-hidden="true">
								<path d="m12 3 9 5-9 5-9-5 9-5Z" /><path d="m3 12 9 5 9-5M3 16l9 5 9-5" />
							</svg>
							<div class={ACTION_DESC}>
								<strong class={ACTION_TITLE}>Preview layers</strong>
								<span class="text-[9px] leading-[1.35] text-[#8ecba7]">Supports are ready.</span>
							</div>
						</button>
					{/if}
				</div>
			{/if}
		{/if}
		{#if previewing}
			{#if previewStatus === 'building'}
				<div
					class="{PREVIEW_STATUS_BASE} border-[rgba(120,150,185,0.32)] bg-[rgba(12,20,30,0.86)] text-[#9fb2c6]"
					role="status"
					aria-live="polite"
				>
					<div class="h-1 w-full overflow-hidden rounded-full bg-[rgba(120,150,185,0.22)]">
						<div
							class="h-full rounded-full bg-[linear-gradient(90deg,#4d9fd6,#7ad0ff)] transition-[width] duration-[160ms]"
							style:width={`${previewPercent}%`}
						></div>
					</div>
					<span>Reconstructing sliced result · {previewPercent}%</span>
				</div>
			{:else if previewStatus === 'error'}
				<div
					class="{PREVIEW_STATUS_BASE} border-red/40 bg-[rgba(48,18,20,0.9)] text-red-soft"
					role="alert"
				>
					<strong class="text-[10px] font-bold tracking-[0.02em] uppercase">Preview failed</strong>
					<span>{previewError ?? 'The sliced preview could not be generated.'}</span>
				</div>
			{:else if previewStatus === 'ready'}
				<div
					class="{PREVIEW_STATUS_BASE} border-[rgba(120,200,255,0.32)] bg-[rgba(12,20,30,0.86)] text-[#a7d4f2]"
					role="status"
				>
					<span
						>{previewLayerCount} layers · Z 0–{previewZHeightMm.toFixed(2)} mm · voxel-accurate</span
					>
					{#if !previewWatertight}
						<span class="leading-[1.35] font-medium text-amber-soft"
							>Mesh was not watertight at sampled pixels — the preview may differ from the print.</span
						>
					{/if}
				</div>
			{/if}
		{/if}
	</div>
</section>

<style>
	.viewport-canvas::before {
		position: absolute;
		inset: 0;
		background-image: radial-gradient(rgba(131, 157, 186, 0.08) 0.65px, transparent 0.65px);
		background-size: 16px 16px;
		content: '';
		mask-image: radial-gradient(circle at center, black, transparent 74%);
		pointer-events: none;
	}
</style>
