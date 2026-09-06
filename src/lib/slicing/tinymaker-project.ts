import transliterate from '@sindresorhus/transliterate';

import { TINYMAKER_PROFILE } from '$lib/printer/tinymaker';

export const TINYMAKER_PROJECT_NAME_MAX_LENGTH = 100;
const fallbackProjectName = 'TinyMaker project';
const reservedFilenameCharacters = '<>:"/\\|?*';

export type TinyMakerProjectMetadata = {
	modelFileName: string;
	layerCount: number;
	volumeCubicMm: number;
};

function decimal(value: number, maximumFractionDigits = 5): string {
	return Number(value.toFixed(maximumFractionDigits)).toString();
}

function hasReservedFilenameCharacter(value: string): boolean {
	return [...value].some((character) => reservedFilenameCharacters.includes(character));
}

function hasNonPrintableAsciiCharacter(value: string): boolean {
	return [...value].some((character) => {
		const codePoint = character.codePointAt(0) ?? 0;
		return codePoint < 0x20 || codePoint > 0x7e;
	});
}

function isReservedWindowsName(value: string): boolean {
	const stem = value.split('.')[0].toUpperCase();
	return /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/.test(stem);
}

export function defaultProjectName(modelFileName: string): string {
	const withoutExtension = modelFileName.replace(/\.stl$/i, '');
	const safe = [...transliterate(withoutExtension)]
		.map((character) =>
			hasNonPrintableAsciiCharacter(character) || hasReservedFilenameCharacter(character)
				? '-'
				: character
		)
		.join('')
		.replace(/^[. ]+|[. ]+$/g, '')
		.slice(0, TINYMAKER_PROJECT_NAME_MAX_LENGTH)
		.replace(/[. ]+$/g, '');
	return safe && /[a-z0-9]/i.test(safe) && !isReservedWindowsName(safe)
		? safe
		: fallbackProjectName;
}

export function validateProjectName(name: string): string | null {
	if (!name.trim()) return 'Enter a project name.';
	if (name.length > TINYMAKER_PROJECT_NAME_MAX_LENGTH) {
		return `Project names cannot exceed ${TINYMAKER_PROJECT_NAME_MAX_LENGTH} characters.`;
	}
	if (hasNonPrintableAsciiCharacter(name)) {
		return 'Project names can use only printable ASCII characters.';
	}
	if (name === '.' || name === '..') return 'Choose a different project name.';
	if (hasReservedFilenameCharacter(name)) {
		return 'Project names cannot contain path separators or reserved filename characters.';
	}
	if (/^[. ]|[. ]$/.test(name)) {
		return 'Project names cannot begin or end with a dot or space.';
	}
	if (isReservedWindowsName(name)) return 'That project name is reserved by the operating system.';
	return null;
}

/** Reproduces the metadata and layer table used by known-good TinyMaker projects. */
export function createTinyMakerGcode(metadata: TinyMakerProjectMetadata): string {
	const { print } = TINYMAKER_PROFILE;
	const volumeMl = metadata.volumeCubicMm / 1000;
	const estimatedPrintTime =
		metadata.layerCount * (print.normalExposureSeconds + print.motionSecondsPerLayer) +
		print.bottomLayerCount * (print.bottomExposureSeconds - print.normalExposureSeconds);
	const lines = [
		`;fileName:${metadata.modelFileName} #0`,
		';machineType:default',
		`;estimatedPrintTime:${decimal(estimatedPrintTime, 1)}`,
		`;volume:${decimal(volumeMl)}`,
		';resin:normal',
		`;weight:${decimal(volumeMl)}`,
		`;price:${decimal(volumeMl / 1000, 8)}`,
		`;layerHeight:${TINYMAKER_PROFILE.layerHeight}`,
		`;resolutionX:${TINYMAKER_PROFILE.resolution.x}`,
		`;resolutionY:${TINYMAKER_PROFILE.resolution.y}`,
		`;machineX:${TINYMAKER_PROFILE.buildVolume.x}`,
		`;machineY:${TINYMAKER_PROFILE.buildVolume.y}`,
		`;machineZ:${TINYMAKER_PROFILE.buildVolume.z}`,
		';projectType:LCD_mirror',
		`;normalExposureTime:${print.normalExposureSeconds}`,
		`;bottomLayExposureTime:${print.bottomExposureSeconds}`,
		`;bottomLayerExposureTime:${print.bottomExposureSeconds}`,
		`;normalDropSpeed:${print.dropSpeedMmPerMinute}`,
		`;normalLayerLiftHeight:${print.liftHeightMm}`,
		';zSlowUpDistance:0',
		`;normalLayerLiftSpeed:${print.liftSpeedMmPerMinute}`,
		`;bottomLayCount:${print.bottomLayerCount}`,
		`;bottomLayerCount:${print.bottomLayerCount}`,
		';mirror:1',
		`;totalLayer:${metadata.layerCount}`,
		`;bottomLayerLiftHeight:${print.liftHeightMm}`,
		`;bottomLayerLiftSpeed:${print.liftSpeedMmPerMinute}`,
		`;bottomLightOffTime:${print.bottomLightOffSeconds}`,
		`;lightOffTime:${print.lightOffSeconds}`,
		';START_GCODE_BEGIN',
		'',
		'',
		';START_GCODE_END'
	];

	for (let layerIndex = 0; layerIndex < metadata.layerCount; layerIndex += 1) {
		lines.push(
			'',
			`;LAYER_START:${layerIndex}`,
			`;currPos:${decimal((layerIndex + 1) * TINYMAKER_PROFILE.layerHeight)}`,
			'',
			';LAYER_END'
		);
	}
	lines.push('', ';END_GCODE_BEGIN', '', ';END_GCODE_END', '');
	return lines.join('\n');
}
