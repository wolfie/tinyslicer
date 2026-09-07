import type {
	ModelRotation,
	ModelScale,
	ModelTranslation
} from '$lib/workspace/build-volume-renderer/types';
import type { Bounds3 } from '$lib/workspace/stl-importer';
import type { ModelSurfaceHit } from '$lib/workspace/supports';
import type { AutoSupportDiagnostics } from './generate-auto-supports';

/** Posted to the worker to start (or supersede) an automatic-support scan.
 *  `positions` is transferred, so the caller must hand over a copy it no longer needs. */
export type AutoSupportRequest = {
	id: number;
	positions: Float32Array;
	bounds: Bounds3;
	translation: ModelTranslation;
	rotation: ModelRotation;
	scale: ModelScale;
};

export type AutoSupportProgressMessage = {
	type: 'progress';
	id: number;
	completed: number;
	total: number;
};

export type AutoSupportResultMessage = {
	type: 'result';
	id: number;
	hits: ModelSurfaceHit[];
	diagnostics: AutoSupportDiagnostics;
};

export type AutoSupportErrorMessage = {
	type: 'error';
	id: number;
	message: string;
};

export type AutoSupportWorkerMessage =
	AutoSupportProgressMessage | AutoSupportResultMessage | AutoSupportErrorMessage;
