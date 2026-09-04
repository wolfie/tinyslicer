export const TINYMAKER_PROFILE = {
	name: 'TinyMaker',
	resolution: { x: 320, y: 240 },
	buildVolume: { x: 40.8, y: 30.6, z: 60 },
	layerHeight: 0.05,
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
