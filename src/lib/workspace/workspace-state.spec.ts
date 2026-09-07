import { describe, expect, it, vi } from 'vitest';

import { TINYMAKER_PROFILE } from '$lib/printer/tinymaker';
import type { AutoSupportRequest } from '$lib/supports/auto-support-worker-types';
import { generateAutoSupportHits } from '$lib/supports/generate-auto-supports';
import type { ImportedStlModel } from './stl-importer';
import { WorkspaceState } from './workspace-state.svelte';

function modelWithinBuildVolume(): ImportedStlModel {
	return {
		name: 'model.stl',
		format: 'Binary',
		positions: new Float32Array([10, 10, 0, 20, 10, 0, 10, 20, 10]),
		normals: new Float32Array(9),
		bounds: { min: { x: 10, y: 10, z: 0 }, max: { x: 20, y: 20, z: 10 } },
		dimensions: { x: 10, y: 10, z: 10 },
		triangleCount: 1,
		byteLength: 134
	};
}

function floatingBoxModel(): ImportedStlModel {
	const minX = 14;
	const minY = 10;
	const minZ = 5;
	const maxX = 24;
	const maxY = 20;
	const maxZ = 6;
	const p000 = [minX, minY, minZ];
	const p100 = [maxX, minY, minZ];
	const p010 = [minX, maxY, minZ];
	const p110 = [maxX, maxY, minZ];
	const p001 = [minX, minY, maxZ];
	const p101 = [maxX, minY, maxZ];
	const p011 = [minX, maxY, maxZ];
	const p111 = [maxX, maxY, maxZ];
	const positions = Float32Array.from(
		[
			[p000, p010, p110],
			[p000, p110, p100],
			[p001, p101, p111],
			[p001, p111, p011],
			[p000, p100, p101],
			[p000, p101, p001],
			[p010, p011, p111],
			[p010, p111, p110],
			[p000, p001, p011],
			[p000, p011, p010],
			[p100, p110, p111],
			[p100, p111, p101]
		].flat(2) as number[]
	);
	return {
		name: 'floating-box.stl',
		format: 'Binary',
		positions,
		normals: new Float32Array(positions.length),
		bounds: {
			min: { x: minX, y: minY, z: minZ },
			max: { x: maxX, y: maxY, z: maxZ }
		},
		dimensions: { x: maxX - minX, y: maxY - minY, z: maxZ - minZ },
		triangleCount: 12,
		byteLength: 684
	};
}

/**
 * Stands in for the auto-support worker: runs the real scan on a microtask and
 * posts one result message, so the workspace's async seeding path is exercised
 * without a real Worker.
 */
class StubAutoSupportWorker {
	onmessage: ((event: MessageEvent) => void) | null = null;
	onerror: ((event: unknown) => void) | null = null;

	postMessage(request: AutoSupportRequest) {
		queueMicrotask(() => {
			const { hits, diagnostics } = generateAutoSupportHits(
				{ positions: request.positions, bounds: request.bounds },
				request.translation,
				request.rotation,
				undefined,
				undefined,
				undefined,
				request.scale
			);
			this.onmessage?.({
				data: { type: 'result', id: request.id, hits, diagnostics }
			} as MessageEvent);
		});
	}

	terminate() {}
}

const stubAutoSupportWorker = (): Promise<Worker> =>
	Promise.resolve(new StubAutoSupportWorker() as unknown as Worker);

describe('workspace workflow', () => {
	it('only enables supports for a loaded model inside the build volume', () => {
		const workspace = new WorkspaceState();

		expect(workspace.scene.isPlaceable).toBe(false);
		expect(workspace.workflow.requestStep('supports')).toBe(false);

		workspace.setModel(modelWithinBuildVolume());
		expect(workspace.scene.isPlaceable).toBe(true);

		workspace.scene.setTranslation({ x: TINYMAKER_PROFILE.buildVolume.x, y: 0, z: 0 });
		expect(workspace.scene.isPlaceable).toBe(false);
		expect(workspace.workflow.requestStep('supports')).toBe(false);
	});

	it('warns when an in-volume model projection overlaps the support margin', () => {
		const workspace = new WorkspaceState();
		workspace.setModel(modelWithinBuildVolume());

		expect(workspace.scene.overlapsSupportMargin).toBe(false);

		workspace.scene.setTranslation({ x: -7, y: 0, z: 0 });

		expect(workspace.scene.outsideBuildVolume).toBe(false);
		expect(workspace.scene.overlapsSupportMargin).toBe(true);
		expect(workspace.scene.isPlaceable).toBe(true);

		workspace.scene.setTranslation({ x: -11, y: 0, z: 0 });

		expect(workspace.scene.outsideBuildVolume).toBe(true);
		expect(workspace.scene.overlapsSupportMargin).toBe(false);
	});

	it('locks model transforms while placing supports', () => {
		const workspace = new WorkspaceState();
		workspace.setModel(modelWithinBuildVolume());
		expect(workspace.workflow.requestStep('supports')).toBe(true);

		workspace.scene.setTranslation({ x: 5, y: 6, z: 7 });
		workspace.scene.setRotation({ x: 1, y: 0, z: 0, w: 0 });
		workspace.scene.setScale(2);

		expect(workspace.scene.translation).toEqual({ x: 0, y: 0, z: 0 });
		expect(workspace.scene.rotation).toEqual({ x: 0, y: 0, z: 0, w: 1 });
		expect(workspace.scene.scale).toBe(1);
		expect(workspace.workflow.interactionMode).toBe('place-supports');
	});

	it('unlocks model transforms again when the workflow returns to prepare', () => {
		const workspace = new WorkspaceState();
		workspace.setModel(modelWithinBuildVolume());
		workspace.workflow.requestStep('supports');
		expect(workspace.scene.transformsLocked).toBe(true);

		expect(workspace.workflow.requestStep('prepare')).toBe(true);
		expect(workspace.scene.transformsLocked).toBe(false);

		workspace.scene.setTranslation({ x: 1, y: 2, z: 3 });
		expect(workspace.scene.translation).toEqual({ x: 1, y: 2, z: 3 });
	});

	it('stores independently identified world-space support points', () => {
		const workspace = new WorkspaceState();
		workspace.setModel(modelWithinBuildVolume());
		workspace.workflow.requestStep('supports');
		const hit = {
			position: { x: 12, y: 14, z: 5 },
			normal: { x: 0, y: 0, z: 1 },
			lowerContactPosition: { x: 12, y: 14, z: 2 }
		};

		expect(workspace.workflow.placeSupport(hit)).toBe(true);
		hit.position.x = 99;
		hit.lowerContactPosition.x = 99;

		expect(workspace.supports.points).toEqual([
			{
				id: 'support-point-1',
				position: { x: 12, y: 14, z: 5 },
				normal: { x: 0, y: 0, z: 1 },
				lowerContactPosition: { x: 12, y: 14, z: 2 }
			}
		]);
	});

	it('rejects support placement outside the Supports step', () => {
		const workspace = new WorkspaceState();
		workspace.setModel(modelWithinBuildVolume());

		expect(
			workspace.workflow.placeSupport({
				position: { x: 12, y: 14, z: 5 },
				normal: { x: 0, y: 0, z: 1 }
			})
		).toBe(false);
		expect(workspace.supports.points).toEqual([]);
	});

	it('generates an editable initial support set when entering Supports', async () => {
		const workspace = new WorkspaceState({ createAutoSupportWorker: stubAutoSupportWorker });
		workspace.setModel(floatingBoxModel());

		expect(workspace.workflow.requestStep('supports')).toBe(true);
		expect(workspace.supports.autoBuild.status).toBe('building');
		await vi.waitFor(() => expect(workspace.supports.autoBuild.status).toBe('ready'), {
			timeout: 5000
		});
		expect(workspace.supports.points.length).toBeGreaterThan(0);
		expect(workspace.supports.autoGeneratedCount).toBe(workspace.supports.points.length);
		expect(workspace.supports.plan.structures).toHaveLength(workspace.supports.points.length);
		expect(workspace.supports.autoDiagnostics).toMatchObject({
			meshIsWatertightAtPixelSamples: true,
			truncated: false
		});
		expect(workspace.supports.points.every((point) => point.normal.z === -1)).toBe(true);

		const generatedIds = workspace.supports.points.map((point) => point.id);
		expect(workspace.workflow.requestStep('supports')).toBe(true);
		expect(workspace.supports.points.map((point) => point.id)).toEqual(generatedIds);

		expect(
			workspace.workflow.placeSupport({
				position: { x: 12, y: 14, z: 5 },
				normal: { x: 0, y: 0, z: -1 }
			})
		).toBe(true);
		expect(new Set(workspace.supports.points.map((point) => point.id)).size).toBe(
			workspace.supports.points.length
		);
	});

	it('keeps unresolved support points separate from generated structures', () => {
		const workspace = new WorkspaceState();
		workspace.setModel(modelWithinBuildVolume());
		workspace.workflow.requestStep('supports');

		expect(
			workspace.workflow.placeSupport({
				position: { x: 12, y: 14, z: 0.5 },
				normal: { x: 0, y: 0, z: -1 }
			})
		).toBe(true);
		expect(workspace.supports.points).toHaveLength(1);
		expect(workspace.supports.plan.structures).toEqual([]);
		expect(workspace.supports.plan.unresolvedPoints).toEqual([
			{ pointId: 'support-point-1', reason: 'insufficient-height' }
		]);
	});

	it('requires confirmation before returning to prepare when supports exist', () => {
		const workspace = new WorkspaceState();
		workspace.setModel(modelWithinBuildVolume());
		workspace.workflow.requestStep('supports');
		workspace.workflow.placeSupport({
			position: { x: 12, y: 14, z: 5 },
			normal: { x: 0, y: 0, z: 1 }
		});

		expect(workspace.workflow.requestStep('prepare')).toBe(false);
		expect(workspace.workflow.step).toBe('supports');
		expect(workspace.workflow.discardDialogOpen).toBe(true);

		workspace.workflow.cancelDiscard();
		expect(workspace.workflow.step).toBe('supports');
		expect(workspace.supports.points).toHaveLength(1);

		workspace.workflow.requestStep('prepare');
		workspace.workflow.confirmDiscard();
		expect(workspace.workflow.step).toBe('prepare');
		expect(workspace.supports.points).toEqual([]);
	});

	it('gates the Preview step on the same rule as Supports', () => {
		const workspace = new WorkspaceState();
		expect(workspace.workflow.canNavigateTo('preview')).toBe(false);

		workspace.setModel(modelWithinBuildVolume());
		expect(workspace.workflow.canNavigateTo('preview')).toBe(true);

		workspace.scene.setTranslation({ x: TINYMAKER_PROFILE.buildVolume.x, y: 0, z: 0 });
		expect(workspace.workflow.canNavigateTo('preview')).toBe(false);
		expect(workspace.workflow.requestStep('preview')).toBe(false);
	});

	it('generates the initial supports once when Preview is entered straight from Prepare', async () => {
		const workspace = new WorkspaceState({ createAutoSupportWorker: stubAutoSupportWorker });
		workspace.setModel(floatingBoxModel());

		expect(workspace.workflow.requestStep('preview')).toBe(true);
		expect(workspace.workflow.step).toBe('preview');
		await vi.waitFor(() => expect(workspace.supports.autoBuild.status).toBe('ready'), {
			timeout: 5000
		});
		expect(workspace.supports.points.length).toBeGreaterThan(0);

		const ids = workspace.supports.points.map((point) => point.id);
		expect(workspace.workflow.requestStep('supports')).toBe(true);
		expect(workspace.supports.points.map((point) => point.id)).toEqual(ids);
	});

	it('moves freely between Preview and Supports but guards the return to Prepare', () => {
		const workspace = new WorkspaceState();
		workspace.setModel(modelWithinBuildVolume());
		workspace.workflow.requestStep('supports');
		workspace.workflow.placeSupport({
			position: { x: 12, y: 14, z: 5 },
			normal: { x: 0, y: 0, z: 1 }
		});

		expect(workspace.workflow.requestStep('preview')).toBe(true);
		expect(workspace.workflow.requestStep('supports')).toBe(true);
		expect(workspace.workflow.requestStep('preview')).toBe(true);

		expect(workspace.workflow.requestStep('prepare')).toBe(false);
		expect(workspace.workflow.step).toBe('preview');
		expect(workspace.workflow.discardDialogOpen).toBe(true);
	});

	it('invalidates a ready slice when a manual support is added', () => {
		const workspace = new WorkspaceState();
		workspace.setModel(modelWithinBuildVolume());
		workspace.workflow.requestStep('supports');
		workspace.preview.status = 'ready';
		workspace.preview.mesh = {
			positions: new Float32Array(9),
			normals: new Float32Array(9)
		};

		workspace.workflow.placeSupport({
			position: { x: 12, y: 14, z: 5 },
			normal: { x: 0, y: 0, z: 1 }
		});

		expect(workspace.preview.status).toBe('idle');
		expect(workspace.preview.mesh).toBeNull();
		expect(workspace.workflow.canNavigateTo('export')).toBe(false);
	});

	it('clears any sliced preview when a new model is loaded', () => {
		const workspace = new WorkspaceState();
		workspace.setModel(modelWithinBuildVolume());
		workspace.workflow.requestStep('preview');

		workspace.setModel({ ...modelWithinBuildVolume(), name: 'replacement.stl' });

		expect(workspace.preview.status).toBe('idle');
		expect(workspace.preview.mesh).toBeNull();
	});

	it('returns directly to prepare when no supports were placed', () => {
		const workspace = new WorkspaceState();
		workspace.setModel(modelWithinBuildVolume());
		workspace.workflow.requestStep('supports');

		expect(workspace.workflow.requestStep('prepare')).toBe(true);
		expect(workspace.workflow.step).toBe('prepare');
		expect(workspace.workflow.discardDialogOpen).toBe(false);
	});

	it('clears support and workflow state when a new model is loaded', () => {
		const workspace = new WorkspaceState();
		workspace.setModel(modelWithinBuildVolume());
		workspace.workflow.requestStep('supports');
		workspace.workflow.placeSupport({
			position: { x: 12, y: 14, z: 5 },
			normal: { x: 0, y: 0, z: 1 }
		});

		workspace.setModel({ ...modelWithinBuildVolume(), name: 'replacement.stl' });

		expect(workspace.workflow.step).toBe('prepare');
		expect(workspace.supports.points).toEqual([]);
		expect(workspace.scene.model?.name).toBe('replacement.stl');
	});
});
