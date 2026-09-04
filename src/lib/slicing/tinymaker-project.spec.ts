import { describe, expect, it } from 'vitest';

import { createTinyMakerGcode, defaultProjectName, validateProjectName } from './tinymaker-project';

describe('TinyMaker project metadata', () => {
	it('matches the fixed profile and layer structure of the reference projects', () => {
		const gcode = createTinyMakerGcode({
			modelFileName: 'part.stl',
			layerCount: 3,
			volumeCubicMm: 2_391.72
		});

		expect(gcode).toContain(';fileName:part.stl #0');
		expect(gcode).toContain(';estimatedPrintTime:147.4');
		expect(gcode).toContain(';volume:2.39172');
		expect(gcode).toContain(';resolutionX:320\n;resolutionY:240');
		expect(gcode).toContain(';projectType:LCD_mirror');
		expect(gcode).toContain(';normalExposureTime:13');
		expect(gcode).toContain(';bottomLayerExposureTime:38');
		expect(gcode).toContain(';totalLayer:3');
		expect(gcode.match(/;LAYER_START:/g)).toHaveLength(3);
		expect(gcode).toContain(';LAYER_START:2\n;currPos:0.15');
		expect(gcode).toMatch(/;END_GCODE_END\n$/);
	});

	it('creates portable default names and rejects path-like names', () => {
		expect(defaultProjectName('tiny:tooth?.STL')).toBe('tiny-tooth-');
		expect(validateProjectName('Tiny tooth')).toBeNull();
		expect(validateProjectName('../tooth')).toMatch(/path separators/);
		expect(validateProjectName('tooth.')).toMatch(/dot or space/);
		expect(validateProjectName('CON')).toMatch(/reserved by the operating system/);
	});
});
