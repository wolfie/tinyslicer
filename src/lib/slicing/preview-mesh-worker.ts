import { buildPreviewMesh } from './preview-mesh';
import type { PreviewMeshRequest, PreviewMeshWorkerMessage } from './preview-mesh-worker-types';

const worker = self as unknown as Worker;

worker.onmessage = (event: MessageEvent<PreviewMeshRequest>) => {
	const request = event.data;
	try {
		const result = buildPreviewMesh(
			{
				model: { positions: request.positions, bounds: request.bounds },
				translation: request.translation,
				rotation: request.rotation,
				supportPlan: request.supportPlan
			},
			(completed, total) => {
				post({ type: 'progress', id: request.id, completed, total });
			}
		);
		post(
			{
				type: 'result',
				id: request.id,
				positions: result.positions,
				normals: result.normals,
				triangleCount: result.triangleCount,
				layerCount: result.layerCount,
				zHeightMm: result.zHeightMm,
				meshIsWatertightAtPixelSamples: result.meshIsWatertightAtPixelSamples
			},
			[result.positions.buffer, result.normals.buffer]
		);
	} catch (error) {
		post({
			type: 'error',
			id: request.id,
			message: error instanceof Error ? error.message : 'Preview generation failed.'
		});
	}
};

function post(message: PreviewMeshWorkerMessage, transfer: Transferable[] = []) {
	worker.postMessage(message, transfer);
}
