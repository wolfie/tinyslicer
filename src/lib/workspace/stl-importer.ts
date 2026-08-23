import { STLLoader } from 'three/addons/loaders/STLLoader.js';

import { TINYMAKER_PROFILE } from '$lib/printer/tinymaker';

export type Point3 = { x: number; y: number; z: number };

export type Bounds3 = {
	min: Point3;
	max: Point3;
};

export type ImportedStlModel = {
	name: string;
	format: 'ASCII' | 'Binary';
	positions: Float32Array;
	normals: Float32Array;
	bounds: Bounds3;
	dimensions: Point3;
	triangleCount: number;
	byteLength: number;
};

const STL_LOADER = new STLLoader();

function detectFormat(data: ArrayBuffer): ImportedStlModel['format'] {
	if (data.byteLength < 84) return 'ASCII';

	const view = new DataView(data);
	const triangleCount = view.getUint32(80, true);
	return 84 + triangleCount * 50 === data.byteLength ? 'Binary' : 'ASCII';
}

function calculateBounds(positions: Float32Array): Bounds3 {
	const min = { x: Infinity, y: Infinity, z: Infinity };
	const max = { x: -Infinity, y: -Infinity, z: -Infinity };

	for (let index = 0; index < positions.length; index += 3) {
		const x = positions[index];
		const y = positions[index + 1];
		const z = positions[index + 2];

		if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
			throw new Error('The STL contains invalid vertex coordinates.');
		}

		min.x = Math.min(min.x, x);
		min.y = Math.min(min.y, y);
		min.z = Math.min(min.z, z);
		max.x = Math.max(max.x, x);
		max.y = Math.max(max.y, y);
		max.z = Math.max(max.z, z);
	}

	return { min, max };
}

export function importStlBuffer(data: ArrayBuffer, name: string): ImportedStlModel {
	let geometry;
	try {
		geometry = STL_LOADER.parse(data);
	} catch {
		throw new Error('This file could not be parsed as an ASCII or binary STL.');
	}

	const positionAttribute = geometry.getAttribute('position');
	if (!positionAttribute || positionAttribute.count === 0 || positionAttribute.count % 3 !== 0) {
		throw new Error('The STL does not contain a valid triangle mesh.');
	}

	let normalAttribute = geometry.getAttribute('normal');
	if (!normalAttribute) {
		geometry.computeVertexNormals();
		normalAttribute = geometry.getAttribute('normal');
	}

	const positions = Float32Array.from(positionAttribute.array);
	const normals = normalAttribute
		? Float32Array.from(normalAttribute.array)
		: new Float32Array(positions.length);
	const sourceBounds = calculateBounds(positions);
	const dimensions = {
		x: sourceBounds.max.x - sourceBounds.min.x,
		y: sourceBounds.max.y - sourceBounds.min.y,
		z: sourceBounds.max.z - sourceBounds.min.z
	};
	const buildVolume = TINYMAKER_PROFILE.buildVolume;
	const offset = {
		x: buildVolume.x / 2 - (sourceBounds.min.x + sourceBounds.max.x) / 2,
		y: buildVolume.y / 2 - (sourceBounds.min.y + sourceBounds.max.y) / 2,
		z: -sourceBounds.min.z
	};

	for (let index = 0; index < positions.length; index += 3) {
		positions[index] += offset.x;
		positions[index + 1] += offset.y;
		positions[index + 2] += offset.z;
	}

	return {
		name,
		format: detectFormat(data),
		positions,
		normals,
		bounds: {
			min: {
				x: sourceBounds.min.x + offset.x,
				y: sourceBounds.min.y + offset.y,
				z: 0
			},
			max: {
				x: sourceBounds.max.x + offset.x,
				y: sourceBounds.max.y + offset.y,
				z: dimensions.z
			}
		},
		dimensions,
		triangleCount: positionAttribute.count / 3,
		byteLength: data.byteLength
	};
}

export async function importStlFile(file: File): Promise<ImportedStlModel> {
	if (!file.name.toLowerCase().endsWith('.stl')) {
		throw new Error('Choose a file with the .stl extension.');
	}

	return importStlBuffer(await file.arrayBuffer(), file.name);
}
