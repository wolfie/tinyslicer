import { SUPPORT_JUNCTION_DIAMETER_MM, type SupportStructure } from '$lib/workspace/supports';
import type { Point3 } from '$lib/workspace/stl-importer';

export const SUPPORT_BRACE_DIAMETER_MM = 0.8;
export const SUPPORT_BRACE_MAX_SPAN_MM = 10;
export const SUPPORT_BRACE_MIN_SPAN_MM = 1;
export const SUPPORT_BRACE_MAX_ANGLE_FROM_VERTICAL_DEGREES = 45;
export const SUPPORT_BRACE_MIN_RISKY_HEIGHT_FRACTION = 0.25;
export const SUPPORT_BRACE_MIN_VERTICAL_RISE_MM = 3;
export const SUPPORT_BRACE_MAX_BEAMS_PER_PAIR = 4;
export const SUPPORT_BRACE_MAX_NEIGHBOURS_PER_RISKY_SHAFT = 2;
export const SUPPORT_BRACE_MIN_NEIGHBOUR_ANGLE_DEGREES = 45;

export type SupportBraceCollisionTest = (start: Point3, end: Point3, radiusMm: number) => boolean;

export type SupportBracingPlan = {
	structures: readonly SupportStructure[];
	beamCount: number;
	unbracedSupportPointIds: readonly string[];
};

type Shaft = {
	pointId: string;
	x: number;
	y: number;
	minimumZ: number;
	maximumZ: number;
};

type NeighbourCandidate = {
	other: Shaft;
	distanceMm: number;
	angleRadians: number;
};

const GEOMETRY_EPSILON_MM = 1e-6;

/**
 * Builds a sparse truss around flagged shafts. Each risky post connects to up to
 * two directionally distinct neighbours; every pair receives an alternating
 * zig-zag of up to four printable diagonals over the useful shared height.
 */
export function generateSupportBracingPlan(
	structures: readonly SupportStructure[],
	riskySupportPointIds: ReadonlySet<string>,
	intersectsModel: SupportBraceCollisionTest = () => false
): SupportBracingPlan {
	const shafts = collectShafts(structures);
	const riskyShafts = shafts
		.filter((shaft) => riskySupportPointIds.has(shaft.pointId))
		.sort((left, right) => left.pointId.localeCompare(right.pointId, undefined, { numeric: true }));
	const structuresByPair = new Map<string, SupportStructure>();
	const neighboursByRiskyPoint = new Map<string, Set<string>>();
	let beamCount = 0;

	for (const risky of riskyShafts) {
		const candidates = shafts
			.filter((other) => other.pointId !== risky.pointId)
			.map((other) => neighbourCandidate(risky, other))
			.filter((candidate): candidate is NeighbourCandidate => candidate !== null)
			.sort(
				(left, right) =>
					left.distanceMm - right.distanceMm ||
					left.other.pointId.localeCompare(right.other.pointId, undefined, { numeric: true })
			);
		const selectedAngles: number[] = [];
		const selectedNeighbours = neighboursByRiskyPoint.get(risky.pointId) ?? new Set<string>();
		neighboursByRiskyPoint.set(risky.pointId, selectedNeighbours);

		for (const candidate of candidates) {
			if (selectedNeighbours.size >= SUPPORT_BRACE_MAX_NEIGHBOURS_PER_RISKY_SHAFT) break;
			if (
				selectedAngles.some(
					(angle) =>
						angularDistance(angle, candidate.angleRadians) <
						(SUPPORT_BRACE_MIN_NEIGHBOUR_ANGLE_DEGREES * Math.PI) / 180
				)
			) {
				continue;
			}
			const pair = orderedPair(risky.pointId, candidate.other.pointId);
			const pairKey = pair.join(':');
			let structure = structuresByPair.get(pairKey);
			if (!structure) {
				const candidateStructure = structureBetween(
					risky,
					candidate.other,
					riskySupportPointIds,
					intersectsModel
				);
				if (!candidateStructure) continue;
				structure = candidateStructure;
				structuresByPair.set(pairKey, structure);
				beamCount += structure.parts.filter((part) => part.kind === 'shaft').length;
			}
			selectedNeighbours.add(candidate.other.pointId);
			selectedAngles.push(candidate.angleRadians);
		}
	}

	return {
		structures: [...structuresByPair.values()],
		beamCount,
		unbracedSupportPointIds: riskyShafts
			.map((shaft) => shaft.pointId)
			.filter((pointId) => (neighboursByRiskyPoint.get(pointId)?.size ?? 0) === 0)
	};
}

function collectShafts(structures: readonly SupportStructure[]): Shaft[] {
	const shafts: Shaft[] = [];
	for (const structure of structures) {
		const pointId = structure.pointIds[0];
		if (!pointId || structure.id.startsWith('brace:')) continue;
		for (const part of structure.parts) {
			if (part.kind !== 'shaft') continue;
			shafts.push({
				pointId,
				x: (part.start.x + part.end.x) / 2,
				y: (part.start.y + part.end.y) / 2,
				minimumZ: Math.min(part.start.z, part.end.z),
				maximumZ: Math.max(part.start.z, part.end.z)
			});
		}
	}
	return shafts;
}

function neighbourCandidate(risky: Shaft, other: Shaft): NeighbourCandidate | null {
	const dx = other.x - risky.x;
	const dy = other.y - risky.y;
	const distanceMm = Math.hypot(dx, dy);
	if (
		distanceMm < SUPPORT_BRACE_MIN_SPAN_MM - GEOMETRY_EPSILON_MM ||
		distanceMm > SUPPORT_BRACE_MAX_SPAN_MM + GEOMETRY_EPSILON_MM
	) {
		return null;
	}
	if (Math.min(risky.maximumZ, other.maximumZ) <= Math.max(risky.minimumZ, other.minimumZ)) {
		return null;
	}
	return { other, distanceMm, angleRadians: Math.atan2(dy, dx) };
}

function structureBetween(
	left: Shaft,
	right: Shaft,
	riskySupportPointIds: ReadonlySet<string>,
	intersectsModel: SupportBraceCollisionTest
): SupportStructure | null {
	const dx = right.x - left.x;
	const dy = right.y - left.y;
	const distanceMm = Math.hypot(dx, dy);
	const minimumZ = Math.max(left.minimumZ, right.minimumZ);
	const maximumZ = Math.min(left.maximumZ, right.maximumZ);
	const endpointMarginMm = SUPPORT_JUNCTION_DIAMETER_MM / 2;
	let usefulMinimumZ = minimumZ + endpointMarginMm;
	for (const shaft of [left, right]) {
		if (!riskySupportPointIds.has(shaft.pointId)) continue;
		usefulMinimumZ = Math.max(
			usefulMinimumZ,
			shaft.minimumZ + (shaft.maximumZ - shaft.minimumZ) * SUPPORT_BRACE_MIN_RISKY_HEIGHT_FRACTION
		);
	}
	const usefulMaximumZ = maximumZ - endpointMarginMm;
	const verticalRiseMm = Math.max(
		SUPPORT_BRACE_MIN_VERTICAL_RISE_MM,
		distanceMm / Math.tan((SUPPORT_BRACE_MAX_ANGLE_FROM_VERTICAL_DEGREES * Math.PI) / 180)
	);
	const availableHeightMm = usefulMaximumZ - usefulMinimumZ;
	const possibleBeamCount = Math.floor((availableHeightMm + GEOMETRY_EPSILON_MM) / verticalRiseMm);
	const targetBeamCount = Math.min(SUPPORT_BRACE_MAX_BEAMS_PER_PAIR, possibleBeamCount);
	if (targetBeamCount <= 0) return null;

	const pair = orderedPair(left.pointId, right.pointId);
	const parts: SupportStructure['parts'][number][] = [];
	const junctionKeys = new Set<string>();
	const spacingMm =
		targetBeamCount === 1 ? 0 : (availableHeightMm - verticalRiseMm) / (targetBeamCount - 1);

	for (let beamIndex = 0; beamIndex < targetBeamCount; beamIndex += 1) {
		const lowerZ =
			targetBeamCount === 1
				? usefulMaximumZ - verticalRiseMm
				: usefulMinimumZ + beamIndex * spacingMm;
		const upperZ = lowerZ + verticalRiseMm;
		const lowerIsLeft = beamIndex % 2 === 0;
		const start = lowerIsLeft
			? { x: left.x, y: left.y, z: lowerZ }
			: { x: right.x, y: right.y, z: lowerZ };
		const end = lowerIsLeft
			? { x: right.x, y: right.y, z: upperZ }
			: { x: left.x, y: left.y, z: upperZ };
		if (intersectsModel(start, end, SUPPORT_BRACE_DIAMETER_MM / 2)) continue;

		addJunction(parts, junctionKeys, start);
		parts.push({
			kind: 'shaft',
			start,
			end,
			startDiameter: SUPPORT_BRACE_DIAMETER_MM,
			endDiameter: SUPPORT_BRACE_DIAMETER_MM
		});
		addJunction(parts, junctionKeys, end);
	}

	return parts.some((part) => part.kind === 'shaft')
		? { id: `brace:${pair.join(':')}`, pointIds: pair, parts }
		: null;
}

function addJunction(
	parts: SupportStructure['parts'][number][],
	keys: Set<string>,
	center: Point3
) {
	const key = `${center.x.toFixed(6)}:${center.y.toFixed(6)}:${center.z.toFixed(6)}`;
	if (keys.has(key)) return;
	keys.add(key);
	parts.push({ kind: 'junction', center: { ...center }, diameter: SUPPORT_JUNCTION_DIAMETER_MM });
}

function angularDistance(left: number, right: number): number {
	const difference = Math.abs(left - right) % (Math.PI * 2);
	return Math.min(difference, Math.PI * 2 - difference);
}

function orderedPair(left: string, right: string): [string, string] {
	return left.localeCompare(right, undefined, { numeric: true }) <= 0
		? [left, right]
		: [right, left];
}
