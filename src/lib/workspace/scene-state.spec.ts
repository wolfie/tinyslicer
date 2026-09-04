import { describe, expect, it } from 'vitest';

import { TINYMAKER_PROFILE } from '$lib/printer/tinymaker';
import { SceneState } from './scene-state.svelte';
import type { ImportedStlModel } from './stl-importer';

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

describe('SceneState', () => {
	it('starts empty and not placeable', () => {
		const scene = new SceneState();

		expect(scene.model).toBeNull();
		expect(scene.isPlaceable).toBe(false);
		expect(scene.transformedBounds).toBeNull();
		expect(scene.transformedDimensions).toBeNull();
	});

	it('loads a model at the origin and reports it as placeable', () => {
		const scene = new SceneState();
		scene.load(modelWithinBuildVolume());

		expect(scene.model?.name).toBe('model.stl');
		expect(scene.translation).toEqual({ x: 0, y: 0, z: 0 });
		expect(scene.isPlaceable).toBe(true);
		expect(scene.outsideBuildVolume).toBe(false);
		expect(scene.transformedDimensions).toEqual({ x: 10, y: 10, z: 10 });
	});

	it('re-derives bounds checks when the model is translated', () => {
		const scene = new SceneState();
		scene.load(modelWithinBuildVolume());

		scene.setTranslation({ x: TINYMAKER_PROFILE.buildVolume.x, y: 0, z: 0 });

		expect(scene.outsideBuildVolume).toBe(true);
		expect(scene.isPlaceable).toBe(false);
	});

	it('ignores transform setters while locked', () => {
		const scene = new SceneState();
		scene.load(modelWithinBuildVolume());

		scene.transformsLocked = true;
		scene.setTranslation({ x: 5, y: 5, z: 5 });
		scene.setRotation({ x: 1, y: 0, z: 0, w: 0 });

		expect(scene.translation).toEqual({ x: 0, y: 0, z: 0 });
		expect(scene.rotation).toEqual({ x: 0, y: 0, z: 0, w: 1 });

		scene.transformsLocked = false;
		scene.setTranslation({ x: 5, y: 5, z: 5 });
		expect(scene.translation).toEqual({ x: 5, y: 5, z: 5 });
	});

	it('clears the previous placement when a new model is loaded', () => {
		const scene = new SceneState();
		scene.load(modelWithinBuildVolume());
		scene.setTranslation({ x: 3, y: 0, z: 0 });

		scene.load({ ...modelWithinBuildVolume(), name: 'replacement.stl' });

		expect(scene.model?.name).toBe('replacement.stl');
		expect(scene.translation).toEqual({ x: 0, y: 0, z: 0 });
		expect(scene.transformsLocked).toBe(false);
	});
});
