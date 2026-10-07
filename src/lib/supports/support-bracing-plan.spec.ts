import { describe, expect, it, vi } from 'vitest';

import { generateSupportBracingPlan } from './support-bracing-plan';
import type { SupportStructure } from '$lib/workspace/supports';

function post(id: string, x: number, z = 30): SupportStructure {
	return postAt(id, x, 5, z);
}

function postAt(id: string, x: number, y: number, z = 30): SupportStructure {
	return {
		id: `post:${id}`,
		pointIds: [id],
		parts: [
			{
				kind: 'shaft',
				start: { x, y, z: 1 },
				end: { x, y, z },
				startDiameter: 1.275,
				endDiameter: 1.275
			}
		]
	};
}

describe('support bracing plan', () => {
	it('connects a risky shaft to its nearest compatible neighbour', () => {
		const result = generateSupportBracingPlan(
			[post('a', 2), post('b', 7), post('c', 11)],
			new Set(['a'])
		);

		expect(result.structures).toHaveLength(1);
		expect(result.structures[0]).toMatchObject({
			id: 'brace:a:b',
			pointIds: ['a', 'b']
		});
		expect(result.structures[0].parts.filter((part) => part.kind === 'shaft')).toHaveLength(4);
		expect(result.beamCount).toBe(4);
		expect(result.unbracedSupportPointIds).toEqual([]);
	});

	it('deduplicates a brace when both connected shafts are risky', () => {
		const result = generateSupportBracingPlan([post('a', 2), post('b', 7)], new Set(['a', 'b']));

		expect(result.structures).toHaveLength(1);
		expect(result.beamCount).toBe(4);
		expect(result.unbracedSupportPointIds).toEqual([]);
	});

	it('connects a risky shaft in two directions to form a truss network', () => {
		const result = generateSupportBracingPlan(
			[postAt('a', 10, 10), postAt('b', 6, 10), postAt('c', 14, 10), postAt('d', 10, 14)],
			new Set(['a'])
		);

		expect(result.structures).toHaveLength(2);
		expect(result.beamCount).toBe(8);
		expect(result.structures.map((structure) => structure.pointIds)).toEqual([
			['a', 'b'],
			['a', 'c']
		]);
	});

	it('leaves a risky shaft unbraced when no neighbour is reachable', () => {
		const result = generateSupportBracingPlan([post('a', 2), post('b', 20)], new Set(['a']));

		expect(result.structures).toEqual([]);
		expect(result.beamCount).toBe(0);
		expect(result.unbracedSupportPointIds).toEqual(['a']);
	});

	it('tries the next neighbour after a model collision', () => {
		const intersectsModel = vi.fn(
			(start: { x: number }, end: { x: number }) => start.x === 6 || end.x === 6
		);
		const result = generateSupportBracingPlan(
			[post('a', 2), post('b', 6), post('c', 9)],
			new Set(['a']),
			intersectsModel
		);

		expect(intersectsModel.mock.calls.length).toBeGreaterThan(4);
		expect(result.structures[0].pointIds).toEqual(['a', 'c']);
	});

	it('rejects pairs without enough shared height for a printable diagonal', () => {
		const result = generateSupportBracingPlan([post('a', 2, 5), post('b', 7, 5)], new Set(['a']));

		expect(result.structures).toEqual([]);
		expect(result.beamCount).toBe(0);
		expect(result.unbracedSupportPointIds).toEqual(['a']);
	});
});
