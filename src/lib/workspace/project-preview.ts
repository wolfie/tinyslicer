import {
	AmbientLight,
	BufferAttribute,
	BufferGeometry,
	Color,
	DirectionalLight,
	Mesh,
	MeshStandardMaterial,
	OrthographicCamera,
	Scene,
	Vector3,
	WebGLRenderer
} from 'three';

import type { PreviewMeshData } from './preview-state.svelte';

const PREVIEW_WIDTH = 640;
const PREVIEW_HEIGHT = 480;
const THUMBNAIL_WIDTH = 150;
const THUMBNAIL_HEIGHT = Math.round((PREVIEW_HEIGHT / PREVIEW_WIDTH) * THUMBNAIL_WIDTH);

function canvasPng(canvas: HTMLCanvasElement): Promise<Blob> {
	return new Promise((resolve, reject) => {
		canvas.toBlob(
			(blob) =>
				blob ? resolve(blob) : reject(new Error('The project preview could not be encoded.')),
			'image/png'
		);
	});
}

/** Renders the immutable sliced mesh into the two preview files expected by TinyMaker projects. */
export async function renderProjectPreviews(
	meshData: PreviewMeshData
): Promise<{ preview: Blob; cropped: Blob }> {
	if (meshData.positions.length === 0) throw new Error('The sliced preview is empty.');

	const canvas = document.createElement('canvas');
	canvas.width = PREVIEW_WIDTH;
	canvas.height = PREVIEW_HEIGHT;
	const renderer = new WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
	renderer.setPixelRatio(1);
	renderer.setSize(PREVIEW_WIDTH, PREVIEW_HEIGHT, false);
	renderer.setClearColor(new Color(0x50565c), 1);
	renderer.outputColorSpace = 'srgb';

	const geometry = new BufferGeometry();
	geometry.setAttribute('position', new BufferAttribute(meshData.positions, 3));
	geometry.setAttribute('normal', new BufferAttribute(meshData.normals, 3));
	geometry.computeBoundingBox();
	const material = new MeshStandardMaterial({ color: 0x35a8e8, roughness: 0.72, metalness: 0 });
	const mesh = new Mesh(geometry, material);
	const scene = new Scene();
	scene.add(mesh, new AmbientLight(0xffffff, 1.35));
	const keyLight = new DirectionalLight(0xffffff, 2.1);
	keyLight.position.set(-1, -2, 3);
	scene.add(keyLight);
	const fillLight = new DirectionalLight(0x80bfff, 0.9);
	fillLight.position.set(2, 1, 1);
	scene.add(fillLight);

	const bounds = geometry.boundingBox;
	if (!bounds) throw new Error('The sliced preview has no bounds.');
	const center = bounds.getCenter(new Vector3());
	const size = bounds.getSize(new Vector3());
	const radius = Math.max(size.length() * 0.62, 1);
	const aspect = PREVIEW_WIDTH / PREVIEW_HEIGHT;
	const camera = new OrthographicCamera(
		-radius * aspect,
		radius * aspect,
		radius,
		-radius,
		0.1,
		radius * 10
	);
	camera.position
		.copy(center)
		.add(new Vector3(1.4, -1.7, 1.15).normalize().multiplyScalar(radius * 4));
	camera.up.set(0, 0, 1);
	camera.lookAt(center);
	renderer.render(scene, camera);

	try {
		const preview = await canvasPng(canvas);
		const thumbnail = document.createElement('canvas');
		thumbnail.width = THUMBNAIL_WIDTH;
		thumbnail.height = THUMBNAIL_HEIGHT;
		const context = thumbnail.getContext('2d');
		if (!context) throw new Error('The project thumbnail could not be rendered.');
		context.drawImage(canvas, 0, 0, THUMBNAIL_WIDTH, THUMBNAIL_HEIGHT);
		return { preview, cropped: await canvasPng(thumbnail) };
	} finally {
		geometry.dispose();
		material.dispose();
		renderer.dispose();
	}
}
