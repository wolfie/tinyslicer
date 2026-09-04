<script lang="ts">
	import { defaultProjectName, validateProjectName } from '$lib/slicing/tinymaker-project';
	import { useExport, usePreview, useScene, useSupports } from './workspace-context';

	type Props = { onBack: () => void };
	let { onBack }: Props = $props();

	const scene = useScene();
	const supports = useSupports();
	const preview = usePreview();
	const projectExport = useExport();
	let projectName = $state(defaultProjectName(scene.model?.name ?? 'TinyMaker project'));
	let nameError = $derived(validateProjectName(projectName));
	let busy = $derived(projectExport.status === 'picking' || projectExport.status === 'slicing');
	let progressPercent = $derived(Math.round(projectExport.progress * 100));

	async function exportProject(destination: 'directory' | 'archive') {
		if (nameError || !scene.model || !preview.mesh) return;
		const input = {
			model: scene.model,
			translation: scene.translation,
			rotation: scene.rotation,
			supportPlan: supports.plan,
			raftIslands: supports.raftPlan.islands,
			previewMesh: preview.mesh
		};
		if (destination === 'directory') await projectExport.start(input, projectName);
		else await projectExport.downloadArchive(input, projectName);
	}
</script>

<section
	class="grid min-w-0 grid-rows-[auto_minmax(0,1fr)] p-[22px] max-mobile:p-[14px]"
	aria-label="Export print project"
>
	<div class="flex items-center justify-between px-0.5 pb-[15px]">
		<div>
			<p class="u-eyebrow mb-1">Final step</p>
			<h1 class="m-0 text-[17px] font-semibold tracking-[-0.02em]">Export print project</h1>
		</div>
		<button
			type="button"
			class="u-chip cursor-pointer border-green/30 text-[#9edeb7] hover:bg-[rgba(29,74,47,0.35)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#65d899] disabled:cursor-not-allowed disabled:opacity-50"
			disabled={busy}
			onclick={onBack}
		>
			<svg class="u-icon w-3.5 [stroke-width:1.6]" viewBox="0 0 18 18" aria-hidden="true"
				><path d="m11.5 4-5 5 5 5" /></svg
			>
			Back to Preview
		</button>
	</div>

	<div
		class="grid min-h-0 place-items-center overflow-auto rounded-xl border border-[#202c3b] bg-[radial-gradient(circle_at_50%_20%,rgba(35,94,78,0.18),transparent_30rem),linear-gradient(180deg,#0e151f_0%,#0b1119_100%)] p-5 shadow-[inset_0_1px_rgba(255,255,255,0.025),0_16px_50px_rgba(0,0,0,0.14)]"
	>
		<div
			class="w-full max-w-[520px] rounded-2xl border border-line bg-[rgba(14,22,31,0.9)] p-6 shadow-[0_24px_70px_rgba(0,0,0,0.28)]"
		>
			<div class="mb-5 flex items-start gap-3">
				<div
					class="grid size-10 shrink-0 place-items-center rounded-xl border border-green/30 bg-green/10 text-green-soft"
				>
					<svg class="u-icon w-5" viewBox="0 0 24 24" aria-hidden="true"
						><path d="M4 5h16v14H4zM8 9h8m-4-4v14" /></svg
					>
				</div>
				<div>
					<h2 class="m-0 text-[14px] font-semibold text-ink-bright">Save the printer project</h2>
					<p class="mt-1.5 mb-0 text-[10px] leading-[1.55] text-ink-4">
						Save directly into a new folder, or download a ZIP containing that folder. TinySlicer
						never writes into an existing project folder.
					</p>
				</div>
			</div>

			<label for="project-name" class="u-eyebrow mb-2 block">Project name</label>
			<input
				id="project-name"
				type="text"
				bind:value={projectName}
				disabled={busy}
				aria-invalid={nameError ? 'true' : undefined}
				aria-describedby="project-name-help"
				class="h-10 w-full rounded-lg border border-line-strong bg-[#0b121a] px-3 text-xs text-ink-bright outline-none focus:border-blue focus:ring-2 focus:ring-blue/20 disabled:opacity-60"
			/>
			<p
				id="project-name-help"
				class={['mt-2 mb-0 min-h-4 text-[10px]', nameError ? 'text-red-soft' : 'text-ink-5']}
			>
				{nameError ?? `Creates “${projectName}” without replacing existing project data.`}
			</p>

			<div class="mt-5 grid grid-cols-2 gap-2 text-[10px] max-mobile:grid-cols-1">
				<div class="rounded-lg border border-line-soft bg-white/[0.02] px-3 py-2.5 text-ink-4">
					<strong class="block text-ink-2">{preview.layerCount} layer PNGs</strong>320 × 240
					grayscale
				</div>
				<div class="rounded-lg border border-line-soft bg-white/[0.02] px-3 py-2.5 text-ink-4">
					<strong class="block text-ink-2">3 project files</strong>Two previews + run.gcode
				</div>
			</div>

			{#if projectExport.status === 'slicing'}
				<div class="mt-5" role="status" aria-live="polite">
					<div class="mb-2 flex justify-between text-[10px] font-semibold text-[#a7d4f2]">
						<span
							>{projectExport.mode === 'archive' ? 'Packing' : 'Writing'} layer {projectExport.completedLayers}
							of {projectExport.totalLayers || '…'}</span
						><span>{progressPercent}%</span>
					</div>
					<div class="h-1.5 overflow-hidden rounded-full bg-[rgba(120,150,185,0.2)]">
						<div
							class="h-full rounded-full bg-[linear-gradient(90deg,#4d9fd6,#70e6a1)] transition-[width] duration-150"
							style:width={`${progressPercent}%`}
						></div>
					</div>
				</div>
			{:else if projectExport.status === 'saved'}
				<p
					class="mt-5 rounded-lg border border-green/35 bg-green/10 px-3 py-2.5 text-[10px] leading-[1.5] text-green-soft"
					role="status"
				>
					{#if projectExport.mode === 'archive'}
						Downloaded <strong>{projectExport.downloadedFilename}</strong>. Extract it to get the
						printer-ready project folder.
					{:else}
						Saved to <strong>{projectExport.savedPath}</strong>. The folder is ready to copy to the
						printer.
					{/if}
				</p>
			{:else if projectExport.status === 'error'}
				<div
					class="mt-5 rounded-lg border border-red/35 bg-red/10 px-3 py-2.5 text-[10px] leading-[1.5] text-red-soft"
					role="alert"
				>
					<strong class="block">Export stopped</strong>{projectExport.error}
					{#if projectExport.partialProjectPath}<span class="mt-1 block text-[#c99191]"
							>A partial folder remains at {projectExport.partialProjectPath}; TinySlicer will never
							reuse it.</span
						>{/if}
				</div>
			{/if}

			<div
				class={[
					'mt-5 grid gap-2',
					projectExport.directorySupported && 'grid-cols-2 max-mobile:grid-cols-1'
				]}
			>
				{#if projectExport.directorySupported}
					<button
						type="button"
						class="flex h-11 items-center justify-center gap-2 rounded-lg border border-green/50 bg-[linear-gradient(#19563a,#15472f)] text-xs font-bold text-[#c8f4d9] shadow-[inset_0_1px_rgba(255,255,255,0.08),0_8px_20px_rgba(0,0,0,0.22)] hover:border-green/75 hover:bg-[linear-gradient(#1d6342,#175137)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-green disabled:cursor-not-allowed disabled:opacity-50"
						disabled={busy || !!nameError}
						onclick={() => exportProject('directory')}
					>
						<svg class="u-icon w-4" viewBox="0 0 18 18" aria-hidden="true"
							><path d="M2.5 5.5h5l1.4 1.5h6.6v7.5h-13z" /><path d="M9 9v4m-2-2h4" /></svg
						>
						{projectExport.status === 'picking'
							? 'Choosing folder…'
							: projectExport.status === 'slicing' && projectExport.mode === 'directory'
								? 'Writing folder…'
								: 'Save to folder'}
					</button>
				{/if}
				<button
					type="button"
					class={[
						'flex h-11 items-center justify-center gap-2 rounded-lg text-xs font-bold shadow-[inset_0_1px_rgba(255,255,255,0.06),0_8px_20px_rgba(0,0,0,0.18)] focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-50',
						projectExport.directorySupported
							? 'border border-blue/45 bg-blue/10 text-[#a8d9f7] hover:border-blue/70 hover:bg-blue/15 focus-visible:outline-blue'
							: 'border border-green/50 bg-[linear-gradient(#19563a,#15472f)] text-[#c8f4d9] hover:border-green/75 hover:bg-[linear-gradient(#1d6342,#175137)] focus-visible:outline-green'
					]}
					disabled={busy || !!nameError || !projectExport.archiveSupported}
					onclick={() => exportProject('archive')}
				>
					<svg class="u-icon w-4" viewBox="0 0 18 18" aria-hidden="true"
						><path d="M4 2.5h7l3 3v10H4zM11 2.5v3h3M6.5 9h5m-5 2.5h5" /></svg
					>
					{projectExport.status === 'slicing' && projectExport.mode === 'archive'
						? 'Building ZIP…'
						: 'Download ZIP'}
				</button>
			</div>
			{#if !projectExport.archiveSupported}
				<p class="mt-2 mb-0 text-center text-[10px] text-amber-soft">
					Export requires a modern browser with Compression Streams support.
				</p>
			{:else if !projectExport.directorySupported}
				<p class="mt-2 mb-0 text-center text-[10px] text-ink-5">
					Your browser does not support direct folder access, so TinySlicer will download a ZIP.
					Your browser handles duplicate download names.
				</p>
			{/if}
		</div>
	</div>
</section>
