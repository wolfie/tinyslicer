import { Mesh, MeshStandardMaterial, Scene } from 'three';
import { describe, expect, it } from 'vitest';

import type { SupportStructure } from '../supports';
import { SupportRenderer } from './support-renderer';

function supportStructure(): SupportStructure {
	return {
		id: 'post:a',
		pointIds: ['a'],
		parts: [
			{
				kind: 'shaft',
				start: { x: 1, y: 2, z: 0 },
				end: { x: 1, y: 2, z: 8 },
				startDiameter: 1,
				endDiameter: 1
			}
		]
	};
}

function renderedSupportMaterial(scene: Scene): MeshStandardMaterial {
	let material: MeshStandardMaterial | null = null;
	scene.traverse((object) => {
		if (material || !(object instanceof Mesh)) return;
		if (object.material instanceof MeshStandardMaterial) material = object.material;
	});
	if (!material) throw new Error('Support mesh was not rendered.');
	return material;
}

describe('SupportRenderer', () => {
	it('makes support posts translucent while manual supports are being placed', () => {
		const scene = new Scene();
		const renderer = new SupportRenderer(scene);
		renderer.setStructures([supportStructure()]);

		const material = renderedSupportMaterial(scene);
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
