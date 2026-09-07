import type { RaftIsland } from '$lib/supports/raft-plan';
import type { ImportedStlModel, Point3 } from '../stl-importer';
import type { SupportPoint, SupportStructure } from '../supports';

export type ModelTranslation = Point3;

export type ModelRotation = {
	x: number;
	y: number;
	z: number;
	w: number;
};

export type ModelScale = number;

export type ModelInteraction =
	{ kind: 'translation' } | { kind: 'rotation'; axis: keyof ModelTranslation } | { kind: 'scale' };

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
	modelScale: ModelScale;
	interactionMode: BuildVolumeInteractionMode;
	supportPoints: readonly SupportPoint[];
	supportStructures: readonly SupportStructure[];
	raftIslands: readonly RaftIsland[];
	previewMesh: { positions: Float32Array; normals: Float32Array } | null;
};
