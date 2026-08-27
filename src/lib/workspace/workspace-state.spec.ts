import { describe, expect, it } from 'vitest';

import { TINYMAKER_PROFILE } from '$lib/printer/tinymaker';
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

describe('workspace workflow', () => {
	it('only enables supports for a loaded model inside the build volume', () => {
		const workspace = new WorkspaceState();

		expect(workspace.canEnterSupports).toBe(false);
		expect(workspace.requestStep('supports')).toBe(false);

		workspace.setModel(modelWithinBuildVolume());
		expect(workspace.canEnterSupports).toBe(true);

		workspace.setModelTranslation({ x: TINYMAKER_PROFILE.buildVolume.x, y: 0, z: 0 });
		expect(workspace.canEnterSupports).toBe(false);
		expect(workspace.requestStep('supports')).toBe(false);
	});

	it('locks model transforms while placing supports', () => {
		const workspace = new WorkspaceState();
		workspace.setModel(modelWithinBuildVolume());
		expect(workspace.requestStep('supports')).toBe(true);

		workspace.setModelTranslation({ x: 5, y: 6, z: 7 });
		workspace.setModelRotation({ x: 1, y: 0, z: 0, w: 0 });

		expect(workspace.modelTranslation).toEqual({ x: 0, y: 0, z: 0 });
		expect(workspace.modelRotation).toEqual({ x: 0, y: 0, z: 0, w: 1 });
		expect(workspace.interactionMode).toBe('place-supports');
	});

	it('stores independently identified world-space support hits', () => {
		const workspace = new WorkspaceState();
		workspace.setModel(modelWithinBuildVolume());
		workspace.requestStep('supports');
		const hit = {
			position: { x: 12, y: 14, z: 5 },
			normal: { x: 0, y: 0, z: 1 }
		};

		expect(workspace.addSupport(hit)).toBe(true);
		hit.position.x = 99;

		expect(workspace.supports).toEqual([
			{
				id: 'support-1',
				position: { x: 12, y: 14, z: 5 },
				normal: { x: 0, y: 0, z: 1 }
			}
		]);
	});

	it('requires confirmation before returning to prepare when supports exist', () => {
		const workspace = new WorkspaceState();
		workspace.setModel(modelWithinBuildVolume());
		workspace.requestStep('supports');
		workspace.addSupport({
			position: { x: 12, y: 14, z: 5 },
			normal: { x: 0, y: 0, z: 1 }
		});

		expect(workspace.requestStep('prepare')).toBe(false);
		expect(workspace.step).toBe('supports');
		expect(workspace.discardSupportsDialogOpen).toBe(true);

		workspace.cancelDiscardSupports();
		expect(workspace.step).toBe('supports');
		expect(workspace.supports).toHaveLength(1);

		workspace.requestStep('prepare');
		workspace.confirmDiscardSupports();
		expect(workspace.step).toBe('prepare');
		expect(workspace.supports).toEqual([]);
	});

	it('returns directly to prepare when no supports were placed', () => {
		const workspace = new WorkspaceState();
		workspace.setModel(modelWithinBuildVolume());
		workspace.requestStep('supports');

		expect(workspace.requestStep('prepare')).toBe(true);
		expect(workspace.step).toBe('prepare');
		expect(workspace.discardSupportsDialogOpen).toBe(false);
	});

	it('clears support and workflow state when a new model is loaded', () => {
		const workspace = new WorkspaceState();
		workspace.setModel(modelWithinBuildVolume());
		workspace.requestStep('supports');
		workspace.addSupport({
			position: { x: 12, y: 14, z: 5 },
			normal: { x: 0, y: 0, z: 1 }
		});

		workspace.setModel({ ...modelWithinBuildVolume(), name: 'replacement.stl' });

		expect(workspace.step).toBe('prepare');
		expect(workspace.supports).toEqual([]);
		expect(workspace.model?.name).toBe('replacement.stl');
	});
});
