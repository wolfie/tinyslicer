<script lang="ts">
	import {
		useExport,
		usePreview,
		useScene,
		useSupports,
		useWorkflow
	} from '$lib/workspace/workspace-context';
	import WorkspaceAsideFooter from './WorkspaceAsideFooter.svelte';
	import WorkspaceAsidePrinterProfile from './WorkspaceAsidePrinterProfile.svelte';

	type Props = {
		importError: string;
	};
	let { importError }: Props = $props();

	const scene = useScene();
	const supports = useSupports();
	const preview = usePreview();
	const workflow = useWorkflow();
	const projectExport = useExport();

	function formatMillimetres(value: number): string {
		return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
	}

	function formatResinMillilitres(volumeCubicMm: number): string {
		const millilitres = volumeCubicMm / 1000;
		if (!Number.isFinite(millilitres) || millilitres <= 0) return '—';
		if (millilitres < 0.01) return '<0.01';
		return millilitres.toLocaleString(undefined, {
			maximumFractionDigits: millilitres < 10 ? 2 : millilitres < 100 ? 1 : 0
		});
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

	function handleScaleChange(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		const percent = Number(input.value);
		if (Number.isFinite(percent) && percent > 0) scene.setScale(percent / 100);
		input.value = String(Math.round(scene.scale * 10000) / 100);
	}
</script>

<aside
	class="grid grid-rows-[auto_auto_1fr] border-l border-line bg-panel max-tablet:hidden"
	aria-label="Scene properties"
>
	<section class="border-b border-line p-[22px]">
		<div class="flex items-start justify-between">
			<div>
				<p class="u-eyebrow mb-1">Scene</p>
				<h2 class="m-0 text-[14px] font-semibold tracking-[-0.02em]" title={scene.model?.name}>
					{scene.model?.name ?? 'No model loaded'}
				</h2>
			</div>
			<span
				class={[
					'mt-[5px] size-2 rounded-full border-2',
					scene.model !== null
						? 'border-[#62b7ed] bg-[#62b7ed] shadow-[0_0_8px_rgba(98,183,237,0.7)]'
						: 'border-[#48566a]'
				]}
			></span>
		</div>
		{#if scene.model}
			<div class="pt-[18px]">
				{#if workflow.step === 'prepare'}
					<div
						class="flex items-center gap-[7px] rounded-[7px] border border-blue/25 bg-blue/10 px-[9px] py-2 text-[10px] font-semibold text-[#86bddf]"
					>
						<span class="u-dot text-blue"></span>Offset X {formatTranslation(scene.translation.x)} · Y
						{formatTranslation(scene.translation.y)} · Z
						{formatTranslation(scene.translation.z)} mm
					</div>
					<div
						class="mt-[7px] flex items-center gap-[7px] rounded-[7px] border border-purple/30 bg-purple/10 px-[9px] py-2 text-[10px] font-semibold text-[#b8acef]"
					>
						<span class="u-dot text-purple"></span>Rotation X {formatDegrees(
							scene.rotationDegrees.x
						)} · Y
						{formatDegrees(scene.rotationDegrees.y)} · Z
						{formatDegrees(scene.rotationDegrees.z)}
					</div>
					<div class="mt-[7px] rounded-[7px] border border-blue/25 bg-blue/10 px-[9px] py-2">
						<div class="flex items-center justify-between gap-2">
							<label class="text-[10px] font-semibold text-[#86bddf]" for="model-scale"
								>Uniform scale</label
							>
							<div
								class="flex items-center rounded-md border border-blue/25 bg-[rgba(8,18,28,0.5)] focus-within:border-blue/60"
							>
								<input
									id="model-scale"
									type="number"
									min="1"
									max="10000"
									step="1"
									value={Math.round(scene.scale * 10000) / 100}
									onchange={handleScaleChange}
									class="w-[62px] bg-transparent px-2 py-1 text-right text-[10px] font-semibold text-ink-2 tabular-nums outline-none"
									aria-label="Model scale percentage"
								/>
								<span class="pr-2 text-[9px] text-ink-5">%</span>
							</div>
						</div>
						<div class="mt-2 flex gap-1.5">
							<button
								type="button"
								class="u-chip flex-1 cursor-pointer justify-center border-blue/25 text-[#8fc8ec] hover:bg-blue/10 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-blue"
								onclick={scene.fitToBuildVolume}
								title="Scale to the largest size that fits the support-safe build area"
							>
								Fit build area
							</button>
							<button
								type="button"
								class="u-chip cursor-pointer justify-center border-line text-ink-4 hover:bg-white/5 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-blue"
								onclick={scene.resetScale}
								disabled={scene.scale === 1}
							>
								Reset
							</button>
						</div>
					</div>
				{:else if workflow.step === 'supports'}
					<div class="rounded-lg border border-green/30 bg-green/12 p-3">
						<div
							class="flex items-center gap-[7px] text-[10px] font-bold tracking-[0.04em] text-green-soft uppercase"
						>
							<span class="u-dot text-green"></span>Support placement
						</div>
						{#if supports.autoBuild.status === 'building'}
							<p class="mt-[9px] mb-[13px] text-[10px] leading-[1.45] text-[#718d7d]">
								Scanning 0.05 mm layers for unsupported regions…
								{Math.round(supports.autoBuild.progress * 100)}%
							</p>
						{:else if supports.autoBuild.status === 'error'}
							<p class="mt-[9px] mb-[13px] text-[10px] leading-[1.45] text-[#718d7d]">
								{supports.autoBuild.error ?? 'Automatic suggestions could not be generated.'} Place supports
								manually.
							</p>
						{:else if supports.autoDiagnostics?.meshIsWatertightAtPixelSamples === false}
							<p class="mt-[9px] mb-[13px] text-[10px] leading-[1.45] text-[#718d7d]">
								Automatic suggestions were skipped because the sampled mesh is open. Review the
								model and place supports manually.
							</p>
						{:else if supports.autoGeneratedCount > 0}
							<p class="mt-[9px] mb-[13px] text-[10px] leading-[1.45] text-[#718d7d]">
								{supports.autoGeneratedCount} initial suggestions were generated from 0.05 mm layers.
								Review them and click the model to add any missing support.
							</p>
						{:else}
							<p class="mt-[9px] mb-[13px] text-[10px] leading-[1.45] text-[#718d7d]">
								No unsupported regions met the initial thresholds. Review the model and click its
								surface to add supports manually.
							</p>
						{/if}
						<strong class="text-[22px] font-[650] text-[#b9f0ce] tabular-nums"
							>{supports.points.length}</strong
						>
						<small class="ml-1.5 text-[9px] text-[#6e917b]"
							>{supports.points.length === 1 ? 'point placed' : 'points placed'}</small
						>
					</div>
				{:else if workflow.step === 'preview'}
					<div class="rounded-lg border border-green/30 bg-green/12 p-3">
						<div
							class="flex items-center gap-[7px] text-[10px] font-bold tracking-[0.04em] text-green-soft uppercase"
						>
							<span class="u-dot text-green"></span>Sliced preview
						</div>
						{#if preview.status === 'building'}
							<p class="mt-[9px] mb-[13px] text-[10px] leading-[1.45] text-[#718d7d]">
								Reconstructing the printed result from 0.05 mm layers…
								{Math.round(preview.progress * 100)}%
							</p>
						{:else if preview.status === 'error'}
							<p class="mt-[9px] mb-[13px] text-[10px] leading-[1.45] text-[#718d7d]">
								{preview.error ?? 'The sliced preview could not be generated.'}
							</p>
						{:else}
							<p class="mt-[9px] mb-[13px] text-[10px] leading-[1.45] text-[#718d7d]">
								Model and supports fused into one immutable, voxel-accurate solid.
							</p>
							{#if preview.status === 'ready' && !preview.watertight}
								<p class="mt-[9px] mb-[13px] text-[10px] leading-[1.45] text-[#718d7d]">
									The sampled mesh was not watertight, so the preview may differ from the printed
									part.
								</p>
							{/if}
						{/if}
						<strong class="text-[22px] font-[650] text-[#b9f0ce] tabular-nums"
							>{preview.layerCount || '—'}</strong
						>
						<small class="ml-1.5 text-[9px] text-[#6e917b]"
							>{preview.layerCount === 1 ? 'layer' : 'layers'} · Z 0–{formatMillimetres(
								preview.zHeightMm
							)} mm</small
						>
						<div class="mt-1 text-[10px] font-semibold text-[#8ecba7]">
							Approx. resin {formatResinMillilitres(preview.volumeCubicMm)} mL
						</div>
					</div>
				{:else if workflow.step === 'export'}
					<div class="rounded-lg border border-blue/25 bg-blue/10 p-3">
						<div
							class="flex items-center gap-[7px] text-[10px] font-bold tracking-[0.04em] text-[#9bccec] uppercase"
						>
							<span class="u-dot text-blue"></span>Print project
						</div>
						<p class="mt-[9px] mb-[13px] text-[10px] leading-[1.45] text-[#71899d]">
							{projectExport.status === 'saved'
								? projectExport.mode === 'archive'
									? 'The complete printer-ready project was packaged as a downloaded ZIP.'
									: 'The complete printer-ready folder was written without replacing existing data.'
								: projectExport.status === 'slicing'
									? projectExport.mode === 'archive'
										? 'Generating grayscale exposure masks and packing them into a ZIP.'
										: 'Generating grayscale exposure masks and writing each one directly to disk.'
									: 'Choose a project name, then save a new folder or download a ZIP.'}
						</p>
						<strong class="text-[22px] font-[650] text-[#b5dcf4] tabular-nums"
							>{projectExport.completedLayers || preview.layerCount}</strong
						>
						<small class="ml-1.5 text-[9px] text-[#6f8ca1]"
							>of {projectExport.totalLayers || preview.layerCount} layers</small
						>
					</div>
				{/if}
				<dl
					class="mt-3 grid text-[10px] [&_dd]:m-0 [&_dd]:text-right [&_dd]:text-ink-2 [&_dd]:tabular-nums [&_dt]:text-ink-5 [&>div]:flex [&>div]:justify-between [&>div]:gap-3 [&>div]:border-b [&>div]:border-line-soft [&>div]:py-2 [&>div:last-child]:border-b-0"
				>
					<div>
						<dt>Dimensions</dt>
						<dd>
							{formatMillimetres(scene.transformedDimensions?.x ?? scene.model.dimensions.x)} &times;
							{formatMillimetres(scene.transformedDimensions?.y ?? scene.model.dimensions.y)} &times;
							{formatMillimetres(scene.transformedDimensions?.z ?? scene.model.dimensions.z)} mm
						</dd>
					</div>
					<div>
						<dt>Triangles</dt>
						<dd>{scene.model.triangleCount.toLocaleString()}</dd>
					</div>
					<div>
						<dt>Encoding</dt>
						<dd>{scene.model.format}</dd>
					</div>
					<div>
						<dt>File size</dt>
						<dd>{formatFileSize(scene.model.byteLength)}</dd>
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
	<WorkspaceAsidePrinterProfile />
	<WorkspaceAsideFooter />
</aside>
