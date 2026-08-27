import {
	ArrowHelper,
	BufferGeometry,
	DoubleSide,
	Float32BufferAttribute,
	Group,
	Line,
	LineBasicMaterial,
	LineSegments,
	Material,
	Mesh,
	MeshBasicMaterial,
	Plane,
	PlaneGeometry,
	SphereGeometry,
	Vector3
} from 'three';

import { TINYMAKER_PROFILE } from '$lib/printer/tinymaker';
import { SUPPORT_PLATE_EDGE_MARGIN_MM } from '../supports';

const BUILD_VOLUME = TINYMAKER_PROFILE.buildVolume;
const RULER_OFFSET = 0.8;
const RULER_MINOR_INTERVAL = 5;
const RULER_MAJOR_INTERVAL = 10;
const RULER_MINOR_TICK_LENGTH = 0.65;
const RULER_MAJOR_TICK_LENGTH = 1.2;

type ClippedRegion = 'inside' | 'outside';

export function createBuildVolumeClippingPlanes(region: ClippedRegion): Plane[] {
	const planes = [
		new Plane(new Vector3(1, 0, 0), 0),
		new Plane(new Vector3(-1, 0, 0), BUILD_VOLUME.x),
		new Plane(new Vector3(0, 1, 0), 0),
		new Plane(new Vector3(0, -1, 0), BUILD_VOLUME.y),
		new Plane(new Vector3(0, 0, 1), 0),
		new Plane(new Vector3(0, 0, -1), BUILD_VOLUME.z)
	];

	return region === 'inside' ? planes : planes.map((plane) => plane.negate());
}

export function createMillimetreRulerVertices(
	origin: Vector3,
	direction: Vector3,
	tickDirection: Vector3,
	length: number
): number[] {
	const rulerDirection = direction.clone().normalize();
	const outwardDirection = tickDirection.clone().normalize();
	const rulerOrigin = origin.clone().addScaledVector(outwardDirection, RULER_OFFSET);
	const vertices = [
		rulerOrigin.x,
		rulerOrigin.y,
		rulerOrigin.z,
		rulerOrigin.x + rulerDirection.x * length,
		rulerOrigin.y + rulerDirection.y * length,
		rulerOrigin.z + rulerDirection.z * length
	];

	for (let distance = 0; distance <= length; distance += RULER_MINOR_INTERVAL) {
		const tickStart = rulerOrigin.clone().addScaledVector(rulerDirection, distance);
		const tickLength =
			distance % RULER_MAJOR_INTERVAL === 0 ? RULER_MAJOR_TICK_LENGTH : RULER_MINOR_TICK_LENGTH;
		const tickEnd = tickStart.clone().addScaledVector(outwardDirection, tickLength);
		vertices.push(tickStart.x, tickStart.y, tickStart.z, tickEnd.x, tickEnd.y, tickEnd.z);
	}

	return vertices;
}

function createLines(vertices: number[], color: number, opacity: number): LineSegments {
	const geometry = new BufferGeometry();
	geometry.setAttribute('position', new Float32BufferAttribute(vertices, 3));
	const material = new LineBasicMaterial({ color, opacity, transparent: opacity < 1 });
	return new LineSegments(geometry, material);
}

function createPlate(): Mesh {
	const geometry = new PlaneGeometry(BUILD_VOLUME.x, BUILD_VOLUME.y);
	const material = new MeshBasicMaterial({
		color: 0x2f4b65,
		opacity: 0.3,
		transparent: true,
		side: DoubleSide,
		depthWrite: false
	});
	const plate = new Mesh(geometry, material);
	plate.position.set(BUILD_VOLUME.x / 2, BUILD_VOLUME.y / 2, -0.01);
	return plate;
}

function createSupportPlateMargin(): Group {
	const group = new Group();
	group.name = 'support-plate-margin';
	const material = new MeshBasicMaterial({
		color: 0x9aa4b2,
		opacity: 0.24,
		transparent: true,
		side: DoubleSide,
		depthWrite: false
	});
	const margin = SUPPORT_PLATE_EDGE_MARGIN_MM;
	const innerHeight = BUILD_VOLUME.y - margin * 2;
	const regions = [
		{ width: BUILD_VOLUME.x, height: margin, x: BUILD_VOLUME.x / 2, y: margin / 2 },
		{
			width: BUILD_VOLUME.x,
			height: margin,
			x: BUILD_VOLUME.x / 2,
			y: BUILD_VOLUME.y - margin / 2
		},
		{ width: margin, height: innerHeight, x: margin / 2, y: BUILD_VOLUME.y / 2 },
		{
			width: margin,
			height: innerHeight,
			x: BUILD_VOLUME.x - margin / 2,
			y: BUILD_VOLUME.y / 2
		}
	];

	for (const region of regions) {
		const mesh = new Mesh(new PlaneGeometry(region.width, region.height), material);
		mesh.position.set(region.x, region.y, 0.005);
		group.add(mesh);
	}

	return group;
}

function createGrid(): LineSegments {
	const vertices: number[] = [];
	for (let x = 5.1; x < BUILD_VOLUME.x; x += 5.1) {
		vertices.push(x, 0, 0, x, BUILD_VOLUME.y, 0);
	}
	for (let y = 5.1; y < BUILD_VOLUME.y; y += 5.1) {
		vertices.push(0, y, 0, BUILD_VOLUME.x, y, 0);
	}
	return createLines(vertices, 0x324054, 0.78);
}

function createBounds(): LineSegments {
	const { x, y, z } = BUILD_VOLUME;
	const segments = [
		[0, 0, 0, x, 0, 0],
		[x, 0, 0, x, y, 0],
		[x, y, 0, 0, y, 0],
		[0, y, 0, 0, 0, 0],
		[0, 0, z, x, 0, z],
		[x, 0, z, x, y, z],
		[x, y, z, 0, y, z],
		[0, y, z, 0, 0, z],
		[0, 0, 0, 0, 0, z],
		[x, 0, 0, x, 0, z],
		[x, y, 0, x, y, z],
		[0, y, 0, 0, y, z]
	];
	return createLines(segments.flat(), 0x70819a, 0.72);
}

function createAxes(): Group {
	const axes = new Group();
	const origin = new Vector3(0, BUILD_VOLUME.y, 0);
	const xDirection = new Vector3(1, 0, 0);
	const yDirection = new Vector3(0, -1, 0);
	const zDirection = new Vector3(0, 0, 1);

	axes.add(new ArrowHelper(xDirection, origin, BUILD_VOLUME.x, 0xff6b70, 1.5, 0.8));
	axes.add(new ArrowHelper(yDirection, origin, BUILD_VOLUME.y, 0x6ee7a8, 1.5, 0.8));
	axes.add(new ArrowHelper(zDirection, origin, BUILD_VOLUME.z, 0x6bb8ff, 1.8, 0.9));
	axes.add(
		createLines(
			createMillimetreRulerVertices(origin, xDirection, new Vector3(0, 1, 0), BUILD_VOLUME.x),
			0xff6b70,
			0.88
		)
	);
	axes.add(
		createLines(
			createMillimetreRulerVertices(origin, yDirection, new Vector3(-1, 0, 0), BUILD_VOLUME.y),
			0x6ee7a8,
			0.88
		)
	);
	axes.add(
		createLines(
			createMillimetreRulerVertices(origin, zDirection, new Vector3(-1, 1, 0), BUILD_VOLUME.z),
			0x6bb8ff,
			0.88
		)
	);
	const marker = new Mesh(
		new SphereGeometry(0.38, 12, 8),
		new MeshBasicMaterial({ color: 0xdce7f4 })
	);
	marker.position.copy(origin);
	axes.add(marker);
	return axes;
}

export class BuildVolumeScene {
	readonly group = new Group();
	#supportPlateMargin = createSupportPlateMargin();

	constructor() {
		this.group.add(
			createPlate(),
			createGrid(),
			this.#supportPlateMargin,
			createBounds(),
			createAxes()
		);
	}

	setSupportPlateMarginVisible(visible: boolean) {
		this.#supportPlateMargin.visible = visible;
	}

	dispose() {
		const geometries = new Set<BufferGeometry>();
		const materials = new Set<Material>();
		this.group.traverse((object) => {
			if (!(object instanceof Mesh || object instanceof Line)) return;
			geometries.add(object.geometry);
			const objectMaterials = Array.isArray(object.material) ? object.material : [object.material];
			for (const material of objectMaterials) materials.add(material);
		});
		for (const geometry of geometries) geometry.dispose();
		for (const material of materials) material.dispose();
		this.group.clear();
	}
}
