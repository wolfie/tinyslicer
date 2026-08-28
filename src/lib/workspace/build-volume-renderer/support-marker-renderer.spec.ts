import { Mesh, Scene, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';

import type { SupportPoint } from '../supports';
import { SUPPORT_MARKER_SURFACE_OFFSET_MM, SupportMarkerRenderer } from './support-marker-renderer';

function supportPoint(id: string, position: Vector3, normal: Vector3): SupportPoint {
	return {
		id,
		position: { x: position.x, y: position.y, z: position.z },
		normal: { x: normal.x, y: normal.y, z: normal.z }
	};
}

describe('SupportMarkerRenderer', () => {
	it('draws one raycastable disc per support point tagged with its id', () => {
		const renderer = new SupportMarkerRenderer(new Scene());

		renderer.setPoints([
			supportPoint('a', new Vector3(1, 2, 3), new Vector3(0, 0, 1)),
			supportPoint('b', new Vector3(4, 5, 6), new Vector3(0, 0, 1))
		]);

		expect(renderer.pickTargets).toHaveLength(2);
		expect(renderer.pickTargets.map((target) => target.userData.supportPointId)).toEqual([
			'a',
			'b'
		]);
		expect(renderer.pickTargets.every((target) => target instanceof Mesh)).toBe(true);
	});

	it('lays each disc flat against the surface normal, lifted just off the surface', () => {
		const renderer = new SupportMarkerRenderer(new Scene());
		const normal = new Vector3(0, 3, 4).normalize();

		renderer.setPoints([supportPoint('a', new Vector3(10, 0, 5), normal)]);

		const [disc] = renderer.pickTargets;
		const discFacing = new Vector3(0, 0, 1).applyQuaternion(disc.quaternion);
		expect(discFacing.x).toBeCloseTo(normal.x);
		expect(discFacing.y).toBeCloseTo(normal.y);
		expect(discFacing.z).toBeCloseTo(normal.z);

		const expected = new Vector3(10, 0, 5).addScaledVector(
			normal,
			SUPPORT_MARKER_SURFACE_OFFSET_MM
		);
		expect(disc.position.x).toBeCloseTo(expected.x);
		expect(disc.position.y).toBeCloseTo(expected.y);
		expect(disc.position.z).toBeCloseTo(expected.z);
	});

	it('reuses discs across updates and drops markers whose point disappeared', () => {
		const renderer = new SupportMarkerRenderer(new Scene());
		renderer.setPoints([
			supportPoint('a', new Vector3(0, 0, 1), new Vector3(0, 0, 1)),
			supportPoint('b', new Vector3(0, 0, 2), new Vector3(0, 0, 1))
		]);
		const discA = renderer.pickTargets.find((target) => target.userData.supportPointId === 'a');

		renderer.setPoints([supportPoint('a', new Vector3(9, 9, 9), new Vector3(0, 0, 1))]);

		expect(renderer.pickTargets).toHaveLength(1);
		expect(renderer.pickTargets[0]).toBe(discA);
		expect(discA?.position.x).toBeCloseTo(9);
	});

	it('falls back to an upward facing disc for a degenerate normal', () => {
		const renderer = new SupportMarkerRenderer(new Scene());

		renderer.setPoints([supportPoint('a', new Vector3(0, 0, 1), new Vector3(0, 0, 0))]);

		const discFacing = new Vector3(0, 0, 1).applyQuaternion(renderer.pickTargets[0].quaternion);
		expect(discFacing.z).toBeCloseTo(1);
	});

	it('removes its group from the scene on dispose', () => {
		const scene = new Scene();
		const renderer = new SupportMarkerRenderer(scene);
		renderer.setPoints([supportPoint('a', new Vector3(0, 0, 1), new Vector3(0, 0, 1))]);

		renderer.dispose();

		expect(scene.children).toHaveLength(0);
	});
});
