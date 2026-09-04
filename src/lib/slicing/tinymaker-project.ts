import { TINYMAKER_PROFILE } from '$lib/printer/tinymaker';

export type TinyMakerProjectMetadata = {
	modelFileName: string;
	layerCount: number;
	volumeCubicMm: number;
};

function decimal(value: number, maximumFractionDigits = 5): string {
	return Number(value.toFixed(maximumFractionDigits)).toString();
}

function hasReservedFilenameCharacter(value: string): boolean {
	return [...value].some(
		(character) => '<>:"/\\|?*'.includes(character) || (character.codePointAt(0) ?? 0) < 32
	);
}

function isReservedWindowsName(value: string): boolean {
	const stem = value.split('.')[0].toUpperCase();
	return /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/.test(stem);
}

export function defaultProjectName(modelFileName: string): string {
	const withoutExtension = modelFileName.replace(/\.stl$/i, '');
	const safe = [...withoutExtension]
		.map((character) => (hasReservedFilenameCharacter(character) ? '-' : character))
		.join('')
		.replace(/[. ]+$/g, '')
		.trim();
	return safe && safe !== '.' && safe !== '..' && !isReservedWindowsName(safe)
		? safe
		: 'TinyMaker project';
}

export function validateProjectName(name: string): string | null {
	if (!name.trim()) return 'Enter a project name.';
	if (name !== name.trim()) return 'Project names cannot begin or end with spaces.';
	if (name === '.' || name === '..') return 'Choose a different project name.';
	if (isReservedWindowsName(name)) return 'That project name is reserved by the operating system.';
	if (hasReservedFilenameCharacter(name)) {
		return 'Project names cannot contain path separators or reserved filename characters.';
	}
	if (/[. ]$/.test(name)) return 'Project names cannot end with a dot or space.';
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
