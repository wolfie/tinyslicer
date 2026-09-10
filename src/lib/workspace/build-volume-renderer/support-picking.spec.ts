import {
	BufferGeometry,
	DoubleSide,
	Float32BufferAttribute,
	Mesh,
	MeshBasicMaterial,
	Raycaster,
	Vector3
} from 'three';
import { describe, expect, it } from 'vitest';

import { SUPPORT_SHAFT_DIAMETER_MM } from '../supports';
import { findModelSurfaceBelow, pickSupportSurface } from './support-picking';

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

describe('finite-radius support collision checking', () => {
	function pickAgainstWall(wallOffsetX: number) {
		const geometry = new BufferGeometry();
		geometry.setAttribute(
			'position',
			new Float32BufferAttribute(
				[
					8,
					8,
					10,
					10,
					12,
					10,
					12,
					8,
					10,
					10 + wallOffsetX,
					9,
					2,
					10 + wallOffsetX,
					11,
					2,
					10 + wallOffsetX,
					11,
					8,
					10 + wallOffsetX,
					9,
					2,
					10 + wallOffsetX,
					11,
					8,
					10 + wallOffsetX,
					9,
					8
				],
				3
			)
		);
		const material = new MeshBasicMaterial({ side: DoubleSide });
		const mesh = new Mesh(geometry, material);
		const raycaster = new Raycaster();
		raycaster.set(new Vector3(10, 10, 12), new Vector3(0, 0, -1));
		const result = pickSupportSurface(mesh, raycaster);
		geometry.dispose();
		material.dispose();
		return result;
	}

	it('rejects a shaft whose radius reaches a wall missed by its centerline', () => {
		expect(pickAgainstWall(SUPPORT_SHAFT_DIAMETER_MM / 2 - 0.05)).toBeNull();
	});

	it('accepts a shaft when a nearby wall remains outside its radius', () => {
		expect(pickAgainstWall(SUPPORT_SHAFT_DIAMETER_MM / 2 + 0.05)).not.toBeNull();
	});
});
