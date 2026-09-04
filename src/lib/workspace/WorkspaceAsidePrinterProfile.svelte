<script lang="ts">
	import { TINYMAKER_PROFILE } from '$lib/printer/tinymaker';
</script>

<section class="border-b border-line p-[22px]">
	<div class="flex items-start justify-between">
		<div>
			<p class="u-eyebrow mb-1">Printer profile</p>
			<h2 class="m-0 text-[14px] font-semibold tracking-[-0.02em]">
				{TINYMAKER_PROFILE.name}
			</h2>
		</div>
		<span class="u-chip gap-[7px] px-[7px] py-1 text-[9px] font-semibold text-[#718198] uppercase"
			>Fixed</span
		>
	</div>
	<dl
		class="mt-[17px] grid text-[10px] [&_dd]:m-0 [&_dd]:text-ink-2 [&_dd]:tabular-nums [&_dt]:text-ink-5 [&>div]:flex [&>div]:justify-between [&>div]:border-b [&>div]:border-line-soft [&>div]:py-[9px] [&>div:last-child]:border-b-0"
	>
		<div>
			<dt>Resolution</dt>
			<dd>{TINYMAKER_PROFILE.resolution.x} &times; {TINYMAKER_PROFILE.resolution.y} px</dd>
		</div>
		<div>
			<dt>Build area</dt>
			<dd>{TINYMAKER_PROFILE.buildVolume.x} &times; {TINYMAKER_PROFILE.buildVolume.y} mm</dd>
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
