import type { Point3 } from './stl-importer';

export const SUPPORT_MARKER_RADIUS_MM = 0.65;

export type ModelSurfaceHit = {
	position: Point3;
	normal: Point3;
};

export type SupportMarker = ModelSurfaceHit & {
	id: string;
};
