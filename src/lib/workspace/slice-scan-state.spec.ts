import { describe, expect, it, vi } from 'vitest';

import { TINYMAKER_PROFILE } from '$lib/printer/tinymaker';
import { SliceScanState, type ScanLayerSource } from './slice-scan-state.svelte';
import type { PreviewBuildStatus, SliceLayerImage } from './preview-state.svelte';

class FakePreview implements ScanLayerSource {
	status: PreviewBuildStatus = 'ready';
	layerCount = 100;
	zHeightMm = 5;
	requests: number[] = [];
	#resolvers = new Map<number, (image: SliceLayerImage) => void>();

	layerPixels(layerIndex: number): Promise<SliceLayerImage> {
		this.requests.push(layerIndex);
		return new Promise((resolve) => this.#resolvers.set(layerIndex, resolve));
	}

	resolve(
		layerIndex: number,
		image: SliceLayerImage = { width: 1, height: 1, pixels: Uint8Array.of(0) }
	) {
		this.#resolvers.get(layerIndex)?.(image);
		this.#resolvers.delete(layerIndex);
	}
}

describe('SliceScanState', () => {
	it('fetches the layer at the default Z when enabled', async () => {
		const preview = new FakePreview();
		const scan = new SliceScanState(preview);

		scan.setEnabled(true);

		expect(scan.zMm).toBeCloseTo(preview.zHeightMm / 2);
		const expectedLayer = Math.floor(scan.zMm / TINYMAKER_PROFILE.layerHeight);
		expect(preview.requests).toEqual([expectedLayer]);
		expect(scan.loading).toBe(true);

		const image = { width: 320, height: 240, pixels: new Uint8Array(320 * 240) };
		preview.resolve(expectedLayer, image);
		await vi.waitFor(() => expect(scan.loading).toBe(false));
		expect(scan.image).toBe(image);
	});

	it('only re-fetches once a drag crosses a layer boundary', () => {
		const preview = new FakePreview();
		const scan = new SliceScanState(preview);
		scan.setEnabled(true);
		preview.resolve(scan.layerIndex);
		preview.requests.length = 0;

		const layerHeight = TINYMAKER_PROFILE.layerHeight;
		const sameLayerZ = scan.zMm + layerHeight * 0.1;
		scan.setZMm(sameLayerZ);
		expect(preview.requests).toEqual([]);

		const nextLayerZ = (scan.layerIndex + 2) * layerHeight;
		scan.setZMm(nextLayerZ);
		expect(preview.requests).toEqual([scan.layerIndex]);
	});

	it('clamps Z to the printed height', () => {
		const preview = new FakePreview();
		const scan = new SliceScanState(preview);
		scan.setEnabled(true);

		scan.setZMm(-10);
		expect(scan.zMm).toBe(0);

		scan.setZMm(1000);
		expect(scan.zMm).toBe(preview.zHeightMm);
	});

	it('discards a stale response that resolves after a newer request was made', async () => {
		const preview = new FakePreview();
		const scan = new SliceScanState(preview);
		scan.setEnabled(true);
		const firstLayer = scan.layerIndex;

		const layerHeight = TINYMAKER_PROFILE.layerHeight;
		scan.setZMm((scan.layerIndex + 3) * layerHeight);
		const secondLayer = scan.layerIndex;
		expect(secondLayer).not.toBe(firstLayer);

		const staleImage = { width: 1, height: 1, pixels: Uint8Array.of(9) };
		const freshImage = { width: 1, height: 1, pixels: Uint8Array.of(42) };
		preview.resolve(secondLayer, freshImage);
		preview.resolve(firstLayer, staleImage);
		await vi.waitFor(() => expect(scan.loading).toBe(false));

		expect(scan.image).toBe(freshImage);
	});

	it('clears the image when disabled and on reset', () => {
		const preview = new FakePreview();
		const scan = new SliceScanState(preview);
		scan.setEnabled(true);
		preview.resolve(scan.layerIndex, { width: 1, height: 1, pixels: Uint8Array.of(1) });

		scan.setEnabled(false);
		expect(scan.image).toBeNull();
		expect(scan.enabled).toBe(false);

		scan.setEnabled(true);
		preview.resolve(scan.layerIndex, { width: 1, height: 1, pixels: Uint8Array.of(2) });
		scan.reset();
		expect(scan.image).toBeNull();
		expect(scan.enabled).toBe(false);
		expect(scan.zMm).toBe(0);
	});

	it('does not fetch while the preview is not ready', () => {
		const preview = new FakePreview();
		preview.status = 'building';
		const scan = new SliceScanState(preview);

		scan.setEnabled(true);

		expect(preview.requests).toEqual([]);
		expect(scan.image).toBeNull();
	});
});
