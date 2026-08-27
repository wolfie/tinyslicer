import type { ImportedStlModel, Point3 } from '../stl-importer';
import type { SupportStructure } from '../supports';

export type ModelTranslation = Point3;

export type ModelRotation = {
	x: number;
	y: number;
	z: number;
	w: number;
};

export type ModelInteraction =
	{ kind: 'translation' } | { kind: 'rotation'; axis: keyof ModelTranslation };

export type BuildVolumeInteractionMode = 'transform-model' | 'place-supports' | 'readonly';

export type BuildVolumeRenderState = {
	cameraYaw: number;
	cameraPitch: number;
	width: number;
	height: number;
	dpr: number;
	model: ImportedStlModel | null;
	modelTranslation: ModelTranslation;
	modelRotation: ModelRotation;
	interactionMode: BuildVolumeInteractionMode;
	supportStructures: readonly SupportStructure[];
};
