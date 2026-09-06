import { describe, expect, it } from 'vitest';

import {
	createTinyMakerGcode,
	defaultProjectName,
	TINYMAKER_PROJECT_NAME_MAX_LENGTH,
	validateProjectName
} from './tinymaker-project';

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

	it('transliterates and sanitizes default project names for the TinyMaker firmware', () => {
		expect(defaultProjectName('tiny:tooth?.STL')).toBe('tiny-tooth-');
		expect(defaultProjectName('Hämmaste.stl')).toBe('Haemmaste');
		expect(defaultProjectName('Я люблю зубы.stl')).toBe('Ya lyublyu zuby');
		expect(defaultProjectName('emoji 🦷 tooth.stl')).toBe('emoji - tooth');
		expect(defaultProjectName('中文模型.stl')).toBe('TinyMaker project');
		expect(defaultProjectName(`${'a'.repeat(99)}.x.stl`)).toBe('a'.repeat(99));
		expect(defaultProjectName(`${'a'.repeat(101)}.stl`)).toBe('a'.repeat(100));
	});

	it('validates manually edited names against the firmware and filesystem limits', () => {
		expect(validateProjectName('Tiny tooth')).toBeNull();
		expect(validateProjectName('a'.repeat(TINYMAKER_PROJECT_NAME_MAX_LENGTH))).toBeNull();
		expect(validateProjectName('a'.repeat(TINYMAKER_PROJECT_NAME_MAX_LENGTH + 1))).toMatch(
			/exceed 100 characters/
		);
		expect(validateProjectName('Hämmaste')).toMatch(/printable ASCII/);
		expect(validateProjectName('../tooth')).toMatch(/path separators/);
		expect(validateProjectName('.tooth')).toMatch(/dot or space/);
		expect(validateProjectName('tooth.')).toMatch(/dot or space/);
		expect(validateProjectName('CON')).toMatch(/reserved by the operating system/);
	});
});
