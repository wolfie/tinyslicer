<script lang="ts">
	type Props = {
		open: boolean;
		supportCount: number;
		onCancel: () => void;
		onConfirm: () => void;
	};

	let { open, supportCount, onCancel, onConfirm }: Props = $props();

	function showModal(dialog: HTMLDialogElement) {
		dialog.showModal();
		return () => {
			if (dialog.open) dialog.close();
		};
	}
</script>

{#if open}
	<dialog
		class="discard-dialog w-[min(420px,calc(100vw_-_32px))] rounded-[13px] border border-[#354458] bg-overlay p-6 text-ink shadow-[0_28px_90px_rgba(0,0,0,0.58)]"
		aria-labelledby="discard-supports-title"
		aria-describedby="discard-supports-description"
		{@attach showModal}
		oncancel={(event) => {
			event.preventDefault();
			onCancel();
		}}
	>
		<div
			class="mb-[17px] grid size-10 place-items-center rounded-[10px] border border-amber/35 bg-amber/12 text-amber"
			aria-hidden="true"
		>
			<svg class="u-icon w-[23px] fill-amber/10" viewBox="0 0 24 24">
				<path d="M12 3 22 20H2L12 3Z" />
				<path d="M12 9v5m0 3v.1" />
			</svg>
		</div>
		<div>
			<p class="u-eyebrow mb-[5px] text-amber-dim">Return to Prepare?</p>
			<h2 id="discard-supports-title" class="text-[18px] font-[650] tracking-[-0.02em]">
				Erase placed supports
			</h2>
			<p id="discard-supports-description" class="mt-[11px] text-[12px] leading-[1.55] text-ink-3">
				Returning to Prepare will erase {supportCount} support {supportCount === 1
					? 'point'
					: 'points'}. This cannot be undone.
			</p>
		</div>
		<div class="mt-6 flex justify-end gap-[9px]">
			<button
				type="button"
				class="h-9 cursor-pointer rounded-lg border border-[#354458] bg-[#17212d] px-[13px] text-[11px] font-[650] text-[#b8c5d4] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue"
				onclick={onCancel}>Keep editing</button
			>
			<button
				type="button"
				class="h-9 cursor-pointer rounded-lg border border-[#9c653a] bg-[linear-gradient(#75462b,#603820)] px-[13px] text-[11px] font-[650] text-[#ffe1cb] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue"
				onclick={onConfirm}>Erase and return</button
			>
		</div>
	</dialog>
{/if}

<style>
	.discard-dialog::backdrop {
		background: rgba(4, 8, 13, 0.76);
		backdrop-filter: blur(5px);
	}
</style>
