import { TINYMAKER_PROFILE } from '$lib/printer/tinymaker';
import type { PreviewBuildStatus, SliceLayerImage } from './preview-state.svelte';

/** The subset of `PreviewBuild` the scan plane needs, narrowed so tests can inject a stub. */
export type ScanLayerSource = {
	readonly status: PreviewBuildStatus;
	readonly layerCount: number;
	readonly zHeightMm: number;
	layerPixels(layerIndex: number): Promise<SliceLayerImage>;
};

const DEFAULT_Z_FRACTION = 0.5;

/**
 * Drives the CAT-scan cross-section: a draggable Z position, the layer it
 * currently falls in, and that layer's cached grayscale image — fetched from the
 * same worker-cached bytes the PNG export streams, never re-rasterized, so the
 * scan plane matches the exported PNG pixel-for-pixel. Purely a display aid: it
 * never touches the model, support, or slice geometry.
 */
export class SliceScanState {
	enabled = $state(false);
	zMm = $state(0);
	image = $state.raw<SliceLayerImage | null>(null);
	loading = $state(false);

	#preview: ScanLayerSource;
	#requestToken = 0;
	#fetchedLayerIndex = -1;

	constructor(preview: ScanLayerSource) {
		this.#preview = preview;
	}

	// A plain getter (not `$derived`, since it reads a constructor-injected field
	// that isn't assigned until after field initializers already ran) — Svelte
	// still tracks `this.zMm` / `this.#preview.layerCount` as reactive dependencies
	// of whichever `$derived`/template reads it, just without `$derived`'s memoizing.
	get layerIndex(): number {
		if (this.#preview.layerCount === 0) return 0;
		return Math.min(
			this.#preview.layerCount - 1,
			Math.max(0, Math.floor(this.zMm / TINYMAKER_PROFILE.layerHeight))
		);
	}

	setEnabled(enabled: boolean) {
		if (enabled === this.enabled) return;
		this.enabled = enabled;
		if (!enabled) {
			this.image = null;
			this.loading = false;
			this.#requestToken += 1;
			return;
		}
		this.zMm = this.#preview.zHeightMm * DEFAULT_Z_FRACTION;
		this.#refresh();
	}

	/** Moves the scan plane. Only re-fetches when the drag crosses a layer boundary. */
	setZMm(zMm: number) {
		this.zMm = Math.min(Math.max(zMm, 0), this.#preview.zHeightMm);
		if (!this.enabled || this.layerIndex === this.#fetchedLayerIndex) return;
		this.#refresh();
	}

	/** Re-fetches the current layer, e.g. after the preview mesh finished rebuilding. */
	refresh() {
		if (this.enabled) this.#refresh();
	}

	reset() {
		this.enabled = false;
		this.zMm = 0;
		this.image = null;
		this.loading = false;
		this.#fetchedLayerIndex = -1;
		this.#requestToken += 1;
	}

	#refresh() {
		if (this.#preview.status !== 'ready') {
			this.image = null;
			return;
		}
		const layerIndex = this.layerIndex;
		this.#fetchedLayerIndex = layerIndex;
		const token = ++this.#requestToken;
		this.loading = true;
		this.#preview
			.layerPixels(layerIndex)
			.then((image) => {
				if (token !== this.#requestToken) return;
				this.image = image;
				this.loading = false;
			})
			.catch(() => {
				if (token !== this.#requestToken) return;
				this.loading = false;
			});
	}
}
