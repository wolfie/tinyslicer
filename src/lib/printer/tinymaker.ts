export const TINYMAKER_FIRMWARE_MAX_LAYER_FILES = 1080;
const TINYMAKER_LAYER_HEIGHT_MM = 0.05;

// TinyMaker is officially advertised with a 60 mm Z build volume:
// https://www.kickstarter.com/projects/tinymaker/tinymaker-3d-printer/description
// Stock firmware v1.0.2 instead rejects projects containing more than 1080 numbered PNGs:
// https://github.com/TinyMaker3D/TinyMaker-Open-Source-3D-Printer/blob/d0952d54ed61ac634ae18101c369ddcbc51cfaa7/Firmware/TinyMaker_Firmware_v1_0_2/TinyMaker_Firmware_v1_0_2.ino#L498-L524
// At the mandatory 0.05 mm file interval, its compatible Z limit is therefore 54 mm.
const TINYMAKER_FIRMWARE_MAX_Z_MM = TINYMAKER_FIRMWARE_MAX_LAYER_FILES * TINYMAKER_LAYER_HEIGHT_MM;

export const TINYMAKER_PROFILE = {
	name: 'TinyMaker',
	resolution: { x: 320, y: 240 },
	buildVolume: { x: 40.8, y: 30.6, z: TINYMAKER_FIRMWARE_MAX_Z_MM },
	layerHeight: TINYMAKER_LAYER_HEIGHT_MM,
	print: {
		normalExposureSeconds: 13,
		bottomExposureSeconds: 38,
		bottomLayerCount: 4,
		liftHeightMm: 2,
		liftSpeedMmPerMinute: 100,
		dropSpeedMmPerMinute: 100,
		lightOffSeconds: 0,
		bottomLightOffSeconds: 0,
		/** Observed fixed lift/drop overhead in TinyMaker reference projects. */
		motionSecondsPerLayer: 2.8
	}
} as const;
