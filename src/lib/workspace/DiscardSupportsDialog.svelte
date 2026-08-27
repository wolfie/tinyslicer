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
		class="discard-dialog"
		aria-labelledby="discard-supports-title"
		aria-describedby="discard-supports-description"
		{@attach showModal}
		oncancel={(event) => {
			event.preventDefault();
			onCancel();
		}}
	>
		<div class="dialog-icon" aria-hidden="true">
			<svg viewBox="0 0 24 24">
				<path d="M12 3 22 20H2L12 3Z" />
				<path d="M12 9v5m0 3v.1" />
			</svg>
		</div>
		<div>
			<p class="eyebrow">Return to Prepare?</p>
			<h2 id="discard-supports-title">Erase placed supports</h2>
			<p id="discard-supports-description">
				Returning to Prepare will erase {supportCount} support {supportCount === 1
					? 'point'
					: 'points'}. This cannot be undone.
			</p>
		</div>
		<div class="dialog-actions">
			<button type="button" class="cancel-button" onclick={onCancel}>Keep editing</button>
			<button type="button" class="confirm-button" onclick={onConfirm}>Erase and return</button>
		</div>
	</dialog>
{/if}

<style>
	.discard-dialog {
		width: min(420px, calc(100vw - 32px));
		padding: 24px;
		border: 1px solid #354458;
		border-radius: 13px;
		background: #111a25;
		box-shadow: 0 28px 90px rgba(0, 0, 0, 0.58);
		color: #edf4fc;
	}
	.discard-dialog::backdrop {
		background: rgba(4, 8, 13, 0.76);
		backdrop-filter: blur(5px);
	}
	.dialog-icon {
		display: grid;
		width: 40px;
		height: 40px;
		margin-bottom: 17px;
		place-items: center;
		border: 1px solid rgba(255, 200, 74, 0.34);
		border-radius: 10px;
		background: rgba(91, 64, 14, 0.25);
		color: #ffc84a;
	}
	.dialog-icon svg {
		width: 23px;
		fill: rgba(255, 200, 74, 0.08);
		stroke: currentColor;
		stroke-linecap: round;
		stroke-linejoin: round;
		stroke-width: 1.5;
	}
	.eyebrow {
		margin: 0 0 5px;
		color: #b18d45;
		font-size: 9px;
		font-weight: 700;
		letter-spacing: 0.14em;
		text-transform: uppercase;
	}
	h2 {
		margin: 0;
		font-size: 18px;
		font-weight: 650;
		letter-spacing: -0.02em;
	}
	p:not(.eyebrow) {
		margin: 11px 0 0;
		color: #91a0b2;
		font-size: 12px;
		line-height: 1.55;
	}
	.dialog-actions {
		display: flex;
		justify-content: flex-end;
		gap: 9px;
		margin-top: 24px;
	}
	.dialog-actions button {
		height: 36px;
		padding: 0 13px;
		border-radius: 8px;
		cursor: pointer;
		font-size: 11px;
		font-weight: 650;
	}
	.cancel-button {
		border: 1px solid #344255;
		background: #17212d;
		color: #b8c5d4;
	}
	.confirm-button {
		border: 1px solid #9c653a;
		background: linear-gradient(#75462b, #603820);
		color: #ffe1cb;
	}
	.dialog-actions button:focus-visible {
		outline: 2px solid #73bfff;
		outline-offset: 2px;
	}
</style>
