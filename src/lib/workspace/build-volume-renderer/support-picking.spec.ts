import { BufferGeometry, DoubleSide, Float32BufferAttribute, Mesh, MeshBasicMaterial } from 'three';
import { describe, expect, it } from 'vitest';

import { findModelSurfaceBelow } from './support-picking';

describe('support collision raycasting', () => {
	it('finds the nearest transformed model surface directly below the shaft', () => {
		const geometry = new BufferGeometry();
		geometry.setAttribute('position', new Float32BufferAttribute([0, 0, 4, 2, 0, 4, 0, 2, 4], 3));
		const mesh = new Mesh(geometry, new MeshBasicMaterial({ side: DoubleSide }));
		mesh.position.set(10, 20, 1);

		expect(findModelSurfaceBelow(mesh, { x: 11, y: 21, z: 10 })).toEqual({
			x: 11,
			y: 21,
			z: 5
		});
		expect(findModelSurfaceBelow(mesh, { x: 13, y: 23, z: 10 })).toBeNull();

		geometry.dispose();
		mesh.material.dispose();
	});
});
