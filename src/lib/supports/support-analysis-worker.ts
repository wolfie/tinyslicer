/// <reference lib="webworker" />

import { analyzeSupportTopology } from './analyze-support-topology';
import type {
	SupportAnalysisRequest,
	SupportAnalysisWorkerMessage
} from './support-analysis-worker-types';

const worker = self as unknown as DedicatedWorkerGlobalScope;

worker.onmessage = (event: MessageEvent<SupportAnalysisRequest>) => {
	const request = event.data;
	try {
		const analysis = analyzeSupportTopology(
			{
				model: { positions: request.positions, bounds: request.bounds },
				translation: request.translation,
				rotation: request.rotation,
				scale: request.scale,
				supportPlan: request.supportPlan,
				supportPoints: request.supportPoints,
				raftIslands: request.raftIslands
			},
			(completed, total) => post({ type: 'progress', id: request.id, completed, total })
		);
		post({ type: 'result', id: request.id, analysis });
	} catch (error) {
		post({
			type: 'error',
			id: request.id,
			message: error instanceof Error ? error.message : 'Support analysis failed.'
		});
	}
};

function post(message: SupportAnalysisWorkerMessage) {
	worker.postMessage(message);
}
