import type { SupportPlan, SupportStructurePart } from '$lib/workspace/supports';

/**
 * A single support part reduced to its footprint on one horizontal slicing plane.
 * The spec (sections 6 and 7.2) permits compositing support cross-sections into the
 * layer mask instead of running a 3D boolean union with the model, so the preview
 * and the future PNG export both slice supports this way.
 */
export type SupportCrossSectionCircle = {
	xMm: number;
	yMm: number;
	radiusMm: number;
};

const DEGENERATE_SPAN_EPSILON_MM = 1e-9;

/**
 * Intersects one support part with the plane `z = zMm` and returns the covered
 * disc, or `null` when the plane misses the part.
 *
 * Angled necks are approximated by the circle centred on the part axis at that
 * height (the true section is a slightly offset ellipse, but the error is well
 * below the 0.1275 mm pixel pitch and it produces a mildly terraced neck that
 * matches how a real print looks).
 */
export function supportPartCircleAtZ(
	part: SupportStructurePart,
	zMm: number
): SupportCrossSectionCircle | null {
	if (part.kind === 'junction') {
		const radius = part.diameter / 2;
		const dz = zMm - part.center.z;
		if (Math.abs(dz) >= radius) return null;
		return {
			xMm: part.center.x,
			yMm: part.center.y,
			radiusMm: Math.sqrt(radius * radius - dz * dz)
		};
	}

	const span = part.end.z - part.start.z;
	if (Math.abs(span) <= DEGENERATE_SPAN_EPSILON_MM) {
		if (Math.abs(zMm - part.start.z) > DEGENERATE_SPAN_EPSILON_MM) return null;
		return {
			xMm: (part.start.x + part.end.x) / 2,
			yMm: (part.start.y + part.end.y) / 2,
			radiusMm: Math.max(part.startDiameter, part.endDiameter) / 2
		};
	}

	const t = (zMm - part.start.z) / span;
	if (t < 0 || t > 1) return null;
	return {
		xMm: part.start.x + (part.end.x - part.start.x) * t,
		yMm: part.start.y + (part.end.y - part.start.y) * t,
		radiusMm: (part.startDiameter + (part.endDiameter - part.startDiameter) * t) / 2
	};
}

/**
 * Every resolved support structure's footprint on the plane `z = zMm`.
 * Unresolved points contribute nothing because they produce no printable post.
 */
export function supportPlanCirclesAtZ(plan: SupportPlan, zMm: number): SupportCrossSectionCircle[] {
	const circles: SupportCrossSectionCircle[] = [];
	for (const structure of plan.structures) {
		for (const part of structure.parts) {
			const circle = supportPartCircleAtZ(part, zMm);
			if (circle && circle.radiusMm > 0) circles.push(circle);
		}
	}
	return circles;
}
