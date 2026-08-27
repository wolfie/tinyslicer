<script lang="ts">
	import type { WorkflowStep } from './workspace-state.svelte';

	type Props = {
		currentStep: WorkflowStep;
		canEnterSupports: boolean;
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

	let { currentStep, canEnterSupports, importing, onStepRequest, onFileSelection }: Props =
		$props();
	let currentStepIndex = $derived(WORKFLOW_STEPS.findIndex((step) => step.id === currentStep));

	function stepEnabled(step: WorkflowStep): boolean {
		if (step === 'prepare') return true;
		if (step === 'supports') return canEnterSupports;
		return false;
	}
</script>

<header class="topbar">
	<div class="brand" aria-label="TinySlicer">
		<span class="brand-mark" aria-hidden="true">
			<svg viewBox="0 0 32 32">
				<path d="M16 3.5 27 9.7v12.6L16 28.5 5 22.3V9.7L16 3.5Z" />
				<path d="m5.5 10 10.5 6 10.5-6M16 16v12" />
			</svg>
		</span>
		<span>Tiny<span>Slicer</span></span>
	</div>
	<nav class="workflow" aria-label="Slicing workflow">
		{#each WORKFLOW_STEPS as workflowStep, index (workflowStep.id)}
			<button
				type="button"
				class={[
					'workflow-step',
					{ active: workflowStep.id === currentStep, completed: index < currentStepIndex }
				]}
				disabled={!stepEnabled(workflowStep.id)}
				aria-current={workflowStep.id === currentStep ? 'step' : undefined}
				onclick={() => onStepRequest(workflowStep.id)}
			>
				<b>{index + 1}</b>{workflowStep.label}
			</button>
			{#if index < WORKFLOW_STEPS.length - 1}
				<span class="workflow-divider" aria-hidden="true"></span>
			{/if}
		{/each}
	</nav>
	<div class="topbar-actions">
		<span class="local-badge">
			<svg viewBox="0 0 16 16" aria-hidden="true">
				<path d="M8 1.5 13 3v4.2c0 3.1-2 5.9-5 7.3-3-1.4-5-4.2-5-7.3V3l5-1.5Z" />
			</svg>
			Local only
		</span>
		<input
			id="stl-file-input"
			class="file-input"
			type="file"
			accept=".stl,model/stl,application/sla"
			disabled={importing}
			onchange={onFileSelection}
		/>
		<label
			class={['open-button', { disabled: importing }]}
			for="stl-file-input"
			aria-disabled={importing}
		>
			<svg viewBox="0 0 18 18" aria-hidden="true">
				<path d="M9 12.5v-9m0 0L5.8 6.7M9 3.5l3.2 3.2M3 11.5v3h12v-3" />
			</svg>
			{importing ? 'Importing…' : 'Open STL'}
		</label>
	</div>
</header>

<style>
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
		gap: 10px;
	}
	.workflow-step {
		display: flex;
		align-items: center;
		gap: 7px;
		padding: 0;
		border: 0;
		background: transparent;
		color: #637083;
		cursor: pointer;
		font-size: 11px;
		font-weight: 600;
		letter-spacing: 0.03em;
		text-transform: uppercase;
	}
	.workflow-step:disabled {
		cursor: not-allowed;
		opacity: 0.55;
	}
	.workflow-step:focus-visible {
		outline: 2px solid #68baff;
		outline-offset: 4px;
		border-radius: 4px;
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
	.workflow-step.completed {
		color: #7eaece;
	}
	.workflow-step.completed b {
		border-color: #356b7c;
		color: #6edba0;
	}
	.workflow-divider {
		width: 18px;
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
	@media (max-width: 1040px) {
		.local-badge {
			display: none;
		}
		.workflow {
			gap: 7px;
		}
		.workflow-divider {
			width: 10px;
		}
	}
	@media (max-width: 820px) {
		.workflow {
			display: none;
		}
		.topbar {
			grid-template-columns: 1fr auto;
		}
	}
	@media (max-width: 520px) {
		.topbar {
			padding: 0 14px;
		}
	}
</style>
