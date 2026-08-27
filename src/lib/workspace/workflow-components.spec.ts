import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';

import DiscardSupportsDialog from './DiscardSupportsDialog.svelte';
import WorkflowHeader from './WorkflowHeader.svelte';
import WorkspaceViewport from './WorkspaceViewport.svelte';
import type { ImportedStlModel } from './stl-importer';

const noop = () => {};

function modelWithinBuildVolume(): ImportedStlModel {
	return {
		name: 'model.stl',
		format: 'Binary',
		positions: new Float32Array([10, 10, 0, 20, 10, 0, 10, 20, 10]),
		normals: new Float32Array(9),
		bounds: { min: { x: 10, y: 10, z: 0 }, max: { x: 20, y: 20, z: 10 } },
		dimensions: { x: 10, y: 10, z: 10 },
		triangleCount: 1,
		byteLength: 134
	};
}

describe('workflow UI', () => {
	it('renders the four workflow steps and only enables available navigation', () => {
		const { body } = render(WorkflowHeader, {
			props: {
				currentStep: 'prepare',
				canEnterSupports: false,
				importing: false,
				onStepRequest: noop,
				onFileSelection: noop
			}
		});

		expect(body).toContain('Prepare');
		expect(body).toContain('Supports');
		expect(body).toContain('Preview');
		expect(body).toContain('Export');
		expect(body).toMatch(/disabled=""><b[^>]*>2<\/b>Supports/);
	});

	it('shows either the supports action or overflow warning in the viewport', () => {
		const model = modelWithinBuildVolume();
		const commonProps = {
			model,
			modelTranslation: { x: 0, y: 0, z: 0 },
			modelRotation: { x: 0, y: 0, z: 0, w: 1 },
			transformedModelBounds: model.bounds,
			interactionMode: 'transform-model' as const,
			supportPointCount: 0,
			supportStructures: [],
			onTranslationChange: noop,
			onRotationChange: noop,
			onSupportPointPlaced: noop,
			onEnterSupports: noop,
			onBackToPrepare: noop
		};

		const valid = render(WorkspaceViewport, {
			props: {
				...commonProps,
				modelOutsideBuildVolume: false,
				canEnterSupports: true
			}
		}).body;
		expect(valid).toContain('Add supports');
		expect(valid).not.toContain('Outside print volume');

		const overflowing = render(WorkspaceViewport, {
			props: {
				...commonProps,
				modelOutsideBuildVolume: true,
				canEnterSupports: false
			}
		}).body;
		expect(overflowing).toContain('Outside print volume');
		expect(overflowing).not.toContain('Add supports');
	});

	it('renders support-mode guidance without model controls', () => {
		const model = modelWithinBuildVolume();
		const { body } = render(WorkspaceViewport, {
			props: {
				model,
				modelTranslation: { x: 0, y: 0, z: 0 },
				modelRotation: { x: 0, y: 0, z: 0, w: 1 },
				transformedModelBounds: model.bounds,
				modelOutsideBuildVolume: false,
				canEnterSupports: true,
				interactionMode: 'place-supports',
				supportPointCount: 0,
				supportStructures: [],
				onTranslationChange: noop,
				onRotationChange: noop,
				onSupportPointPlaced: noop,
				onEnterSupports: noop,
				onBackToPrepare: noop
			}
		});

		expect(body).toContain('Place supports');
		expect(body).toContain('Back to Prepare');
		expect(body).toContain('0 support points placed');
		expect(body).not.toContain('Add supports');
	});

	it('only renders the destructive dialog while confirmation is pending', () => {
		const closed = render(DiscardSupportsDialog, {
			props: { open: false, supportCount: 2, onCancel: noop, onConfirm: noop }
		}).body;
		expect(closed).not.toContain('Erase placed supports');

		const open = render(DiscardSupportsDialog, {
			props: { open: true, supportCount: 2, onCancel: noop, onConfirm: noop }
		}).body;
		expect(open).toContain('Erase placed supports');
		expect(open).toContain('erase 2 support points');
	});
});
