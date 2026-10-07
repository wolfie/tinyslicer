import type { RaftIsland } from './raft-plan';
import type { SupportTopologyAnalysis } from './analyze-support-topology';
import type {
	ModelRotation,
	ModelScale,
	ModelTranslation
} from '$lib/workspace/build-volume-renderer/types';
import type { Bounds3 } from '$lib/workspace/stl-importer';
import type { SupportPlan, SupportPoint } from '$lib/workspace/supports';

export type SupportAnalysisRequest = {
	id: number;
	positions: Float32Array;
	bounds: Bounds3;
	translation: ModelTranslation;
	rotation: ModelRotation;
	scale: ModelScale;
	supportPlan: SupportPlan;
	supportPoints: readonly SupportPoint[];
	raftIslands: readonly RaftIsland[];
};

export type SupportAnalysisWorkerMessage =
	| { type: 'progress'; id: number; completed: number; total: number }
	| { type: 'result'; id: number; analysis: SupportTopologyAnalysis }
	| { type: 'error'; id: number; message: string };
