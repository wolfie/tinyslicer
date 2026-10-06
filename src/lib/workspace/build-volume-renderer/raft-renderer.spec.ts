import { Mesh, MeshStandardMaterial, Scene } from 'three';
import { describe, expect, it } from 'vitest';

import type { RaftIsland } from '$lib/supports/raft-plan';
import { RaftRenderer } from './raft-renderer';

function raftIsland(): RaftIsland {
	const square = [
		{ x: 8, y: 8 },
		{ x: 12, y: 8 },
		{ x: 12, y: 12 },
		{ x: 8, y: 12 }
	];
	return {
		id: 'raft:a',
		supportPointIds: ['a', 'b'],
		hull: square,
		core: square,
		coreRadiusMm: 1.5,
		coreHeightMm: 0.3,
		brimWidthMm: 1.5,
		brimAngleDeg: 45
	};
}

function renderedRaftMaterial(scene: Scene): MeshStandardMaterial {
	let material: MeshStandardMaterial | null = null;
	scene.traverse((object) => {
		if (material || !(object instanceof Mesh)) return;
		if (object.material instanceof MeshStandardMaterial) material = object.material;
	});
	if (!material) throw new Error('Raft mesh was not rendered.');
	return material;
}

describe('RaftRenderer', () => {
	it('makes raft bases translucent while manual supports are being placed', () => {
		const scene = new Scene();
		const renderer = new RaftRenderer(scene);
		renderer.setIslands([raftIsland()]);

		const material = renderedRaftMaterial(scene);
		expect(material.transparent).toBe(false);
		expect(material.opacity).toBe(1);
		expect(material.depthWrite).toBe(true);

		renderer.setTranslucent(true);

		expect(material.transparent).toBe(true);
		expect(material.opacity).toBeLessThan(1);
		expect(material.depthWrite).toBe(false);

		renderer.setTranslucent(false);

		expect(material.transparent).toBe(false);
		expect(material.opacity).toBe(1);
		expect(material.depthWrite).toBe(true);
	});
});
