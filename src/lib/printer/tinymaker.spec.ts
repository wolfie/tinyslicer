import { describe, expect, it } from 'vitest';

import { TINYMAKER_FIRMWARE_MAX_LAYER_FILES, TINYMAKER_PROFILE } from './tinymaker';

describe('TinyMaker profile', () => {
	it('limits Z to the numbered layer files accepted by the stock firmware', () => {
		expect(TINYMAKER_PROFILE.buildVolume.z).toBe(54);
		expect(TINYMAKER_PROFILE.buildVolume.z / TINYMAKER_PROFILE.layerHeight).toBe(
			TINYMAKER_FIRMWARE_MAX_LAYER_FILES
		);
	});
});
