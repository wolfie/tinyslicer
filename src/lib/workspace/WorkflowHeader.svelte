<script lang="ts">
	import type { WorkflowStep } from './workspace-state.svelte';

	type Props = {
		currentStep: WorkflowStep;
		canEnterSupports: boolean;
		canEnterExport: boolean;
		importing: boolean;
		onStepRequest: (step: WorkflowStep) => void;
		onFileSelection: (event: Event) => void;
	};

	const WORKFLOW_STEPS: { id: WorkflowStep; label: string }[] = [
		{ id: 'prepare', label: 'Prepare' },
		{ id: 'supports', label: 'Supports' },
		{ id: 'preview', label: 'Preview' },
		{ id: 'export', label: 'Export' }
	];

	let {
		currentStep,
		canEnterSupports,
		canEnterExport,
		importing,
		onStepRequest,
		onFileSelection
	}: Props = $props();
	let currentStepIndex = $derived(WORKFLOW_STEPS.findIndex((step) => step.id === currentStep));

	function stepEnabled(step: WorkflowStep): boolean {
		if (step === 'prepare') return true;
		if (step === 'supports' || step === 'preview') return canEnterSupports;
		return canEnterExport;
	}

	function stepState(id: WorkflowStep, index: number): 'active' | 'completed' | 'idle' {
		if (id === currentStep) return 'active';
		if (index < currentStepIndex) return 'completed';
		return 'idle';
	}

	const STEP_LABEL_CLASS = {
		active: 'text-[#bddcf8]',
		completed: 'text-[#7eaece]',
		idle: 'text-ink-4'
	};
	const STEP_BADGE_CLASS = {
		active: 'border-[#3d7bac] bg-[#16334a] text-[#82c6ff]',
		completed: 'border-[#356b7c] text-[#6edba0]',
		idle: 'border-line-strong'
	};
</script>

<header
	class="grid h-[68px] grid-cols-[1fr_auto_1fr] items-center border-b border-line bg-[rgba(12,18,26,0.88)] px-[22px] backdrop-blur-[16px] max-tablet:grid-cols-[1fr_auto] max-mobile:px-[14px]"
>
	<div
		class="inline-flex w-fit items-center gap-[10px] text-[16px] font-[650] tracking-[-0.02em] text-ink-bright"
		aria-label="TinySlicer"
	>
		<span
			class="grid size-8 place-items-center rounded-[9px] border border-[#27527a] bg-[linear-gradient(145deg,#18324a,#101c29)] shadow-[0_7px_22px_rgba(0,0,0,0.3)]"
			aria-hidden="true"
		>
			<svg
				class="w-5 fill-blue/10 stroke-blue [stroke-width:1.4] [stroke-linejoin:round]"
				viewBox="0 0 32 32"
			>
				<path d="M16 3.5 27 9.7v12.6L16 28.5 5 22.3V9.7L16 3.5Z" />
				<path d="m5.5 10 10.5 6 10.5-6M16 16v12" />
			</svg>
		</span>
		<span>Tiny<span class="text-blue">Slicer</span></span>
	</div>
	<nav
		class="flex items-center gap-[10px] max-compact:gap-[7px] max-tablet:hidden"
		aria-label="Slicing workflow"
	>
		{#each WORKFLOW_STEPS as workflowStep, index (workflowStep.id)}
			<button
				type="button"
				class={[
					'flex cursor-pointer items-center gap-[7px] border-0 bg-transparent text-[11px] font-semibold tracking-[0.03em] uppercase focus-visible:rounded focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-blue disabled:cursor-not-allowed disabled:opacity-[0.55]',
					STEP_LABEL_CLASS[stepState(workflowStep.id, index)]
				]}
				disabled={!stepEnabled(workflowStep.id)}
				aria-current={workflowStep.id === currentStep ? 'step' : undefined}
				onclick={() => onStepRequest(workflowStep.id)}
			>
				<b
					class={[
						'grid size-[19px] place-items-center rounded-full border text-[9px]',
						STEP_BADGE_CLASS[stepState(workflowStep.id, index)]
					]}>{index + 1}</b
				>{workflowStep.label}
			</button>
			{#if index < WORKFLOW_STEPS.length - 1}
				<span class="h-px w-[18px] bg-[#273244] max-compact:w-[10px]" aria-hidden="true"></span>
			{/if}
		{/each}
	</nav>
	<div class="flex items-center justify-end gap-[14px]">
		<span class="inline-flex items-center gap-1.5 text-[11px] text-[#728298] max-compact:hidden">
			<svg class="u-icon w-3.5 [stroke-width:1.2]" viewBox="0 0 16 16" aria-hidden="true">
				<path d="M8 1.5 13 3v4.2c0 3.1-2 5.9-5 7.3-3-1.4-5-4.2-5-7.3V3l5-1.5Z" />
			</svg>
			Local only
		</span>
		<input
			id="stl-file-input"
			class="sr-only"
			type="file"
			accept=".stl,model/stl,application/sla"
			disabled={importing}
			onchange={onFileSelection}
		/>
		<label
			class={[
				'inline-flex h-9 items-center gap-2 rounded-lg border border-[#356b96] bg-[linear-gradient(#214968,#1a3d58)] px-3.5 text-xs font-semibold text-[#d7ecff] shadow-[inset_0_1px_rgba(255,255,255,0.08),0_4px_14px_rgba(0,0,0,0.18)]',
				importing ? 'cursor-wait opacity-70' : 'cursor-pointer'
			]}
			for="stl-file-input"
			aria-disabled={importing}
		>
			<svg class="u-icon w-4" viewBox="0 0 18 18" aria-hidden="true">
				<path d="M9 12.5v-9m0 0L5.8 6.7M9 3.5l3.2 3.2M3 11.5v3h12v-3" />
			</svg>
			{importing ? 'Importing…' : 'Open STL'}
		</label>
	</div>
</header>
