import type { AutoSupportRequest, AutoSupportWorkerMessage } from './auto-support-worker-types';
import { generateAutoSupportHits } from './generate-auto-supports';

const worker = self as unknown as Worker;

worker.onmessage = (event: MessageEvent<AutoSupportRequest>) => {
	const request = event.data;
	try {
		const { hits, diagnostics } = generateAutoSupportHits(
			{ positions: request.positions, bounds: request.bounds },
			request.translation,
			request.rotation,
			(completed, total) => {
				post({ type: 'progress', id: request.id, completed, total });
			},
			undefined,
			undefined,
			request.scale
		);
		post({ type: 'result', id: request.id, hits: [...hits], diagnostics });
	} catch (error) {
		post({
			type: 'error',
			id: request.id,
			message: error instanceof Error ? error.message : 'Automatic support generation failed.'
		});
	}
};

function post(message: AutoSupportWorkerMessage) {
	worker.postMessage(message);
}
