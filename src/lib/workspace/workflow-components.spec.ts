import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';

import DiscardSupportsDialog from './DiscardSupportsDialog.svelte';
import WorkflowHeader from './WorkflowHeader.svelte';
import WorkspaceViewport from './WorkspaceViewport.svelte';
import type { ImportedStlModel } from './stl-importer';

const noop = () => {};

const previewProps = {
	raftIslands: [],
	autoSupportStatus: 'idle' as const,
	autoSupportProgress: 0,
	previewStatus: 'idle' as const,
	previewProgress: 0,
	previewMesh: null,
	previewLayerCount: 0,
	previewZHeightMm: 0,
	previewVolumeCubicMm: 0,
	previewWatertight: true,
	previewError: null,
	onEnterPreview: noop,
	onBackToSupports: noop,
	onEnterExport: noop
};

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
				canEnterExport: false,
				importing: false,
				onStepRequest: noop,
				onFileSelection: noop
			}
		});

		expect(body).toContain('Prepare');
		expect(body).toContain('Supports');
		expect(body).toContain('Preview');
		expect(body).toContain('Export');
		expect(body).toMatch(/build \d+ \d{4}-\d{2}-\d{2}/);
		expect(body).toMatch(/disabled=""><b[^>]*>2<\/b>Supports/);
	});

	it('shows either the supports action or overflow warning in the viewport', () => {
		const model = modelWithinBuildVolume();
		const commonProps = {
			model,
			modelTranslation: { x: 0, y: 0, z: 0 },
			modelRotation: { x: 0, y: 0, z: 0, w: 1 },
			transformedModelBounds: model.bounds,
			modelOverlapsSupportMargin: false,
			interactionMode: 'transform-model' as const,
			supportPointCount: 0,
			supportPoints: [],
			supportStructures: [],
			onTranslationChange: noop,
			onRotationChange: noop,
			onSupportPointPlaced: noop,
			onEnterSupports: noop,
			onBackToPrepare: noop,
			...previewProps
		};

		const valid = render(WorkspaceViewport, {
			props: {
				...commonProps,
				modelOutsideBuildVolume: false,
				canEnterSupports: true
			}
		}).body;
		expect(valid).toContain('Add supports');
		expect(valid).not.toContain('Preview layers');
		expect(valid).not.toContain('Outside print volume');
		expect(valid).not.toContain('Limited support area');

		const nearEdge = render(WorkspaceViewport, {
			props: {
				...commonProps,
				modelOutsideBuildVolume: false,
				modelOverlapsSupportMargin: true,
				canEnterSupports: true
			}
		}).body;
		expect(nearEdge).toContain('Limited support area');
		expect(nearEdge).toContain('Parts of the model are too close to the edge for supports.');
		expect(nearEdge).toContain('Add supports');

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
				modelOverlapsSupportMargin: false,
				canEnterSupports: true,
				interactionMode: 'place-supports',
				supportPointCount: 0,
				supportPoints: [],
				supportStructures: [],
				onTranslationChange: noop,
				onRotationChange: noop,
				onSupportPointPlaced: noop,
				onEnterSupports: noop,
				onBackToPrepare: noop,
				...previewProps
			}
		});

		expect(body).toContain('Place supports');
		expect(body).toContain('Back to Prepare');
		expect(body).toContain('0 support points placed');
		expect(body).toContain('Preview layers');
		expect(body).not.toContain('Add supports');
	});

	it('shows automatic-support generation progress in the viewport', () => {
		const model = modelWithinBuildVolume();
		const { body } = render(WorkspaceViewport, {
			props: {
				model,
				modelTranslation: { x: 0, y: 0, z: 0 },
				modelRotation: { x: 0, y: 0, z: 0, w: 1 },
				transformedModelBounds: model.bounds,
				modelOutsideBuildVolume: false,
				modelOverlapsSupportMargin: false,
				canEnterSupports: true,
				interactionMode: 'place-supports',
				supportPointCount: 0,
				supportPoints: [],
				supportStructures: [],
				onTranslationChange: noop,
				onRotationChange: noop,
				onSupportPointPlaced: noop,
				onEnterSupports: noop,
				onBackToPrepare: noop,
				...previewProps,
				autoSupportStatus: 'building',
				autoSupportProgress: 0.4
			}
		});

		expect(body).toContain('Generating initial supports · 40%');
		expect(body).not.toContain('0 support points placed');
		expect(body).not.toContain('Preview layers');
	});

	it('enables the Preview step once a model fits the build volume', () => {
		const disabled = render(WorkflowHeader, {
			props: {
				currentStep: 'prepare',
				canEnterSupports: false,
				canEnterExport: false,
				importing: false,
				onStepRequest: noop,
				onFileSelection: noop
			}
		}).body;
		expect(disabled).toMatch(/disabled=""><b[^>]*>3<\/b>Preview/);

		const enabled = render(WorkflowHeader, {
			props: {
				currentStep: 'supports',
				canEnterSupports: true,
				canEnterExport: false,
				importing: false,
				onStepRequest: noop,
				onFileSelection: noop
			}
		}).body;
		expect(enabled).not.toMatch(/disabled=""><b[^>]*>3<\/b>Preview/);
	});

	it('shows read-only sliced-preview status in the viewport', () => {
		const model = modelWithinBuildVolume();
		const { body } = render(WorkspaceViewport, {
			props: {
				model,
				modelTranslation: { x: 0, y: 0, z: 0 },
				modelRotation: { x: 0, y: 0, z: 0, w: 1 },
				transformedModelBounds: model.bounds,
				modelOutsideBuildVolume: false,
				modelOverlapsSupportMargin: false,
				canEnterSupports: true,
				interactionMode: 'readonly',
				supportPointCount: 0,
				supportPoints: [],
				supportStructures: [],
				onTranslationChange: noop,
				onRotationChange: noop,
				onSupportPointPlaced: noop,
				onEnterSupports: noop,
				onBackToPrepare: noop,
				...previewProps,
				previewStatus: 'building',
				previewProgress: 0.5
			}
		});

		expect(body).toContain('Sliced preview');
		expect(body).toContain('Back to Supports');
		expect(body).toContain('Reconstructing sliced result · 50%');
		expect(body).not.toContain('Add supports');
		expect(body).not.toContain('Preview layers');
	});

	it('shows estimated resin volume in the sliced-preview status', () => {
		const model = modelWithinBuildVolume();
		const { body } = render(WorkspaceViewport, {
			props: {
				model,
				modelTranslation: { x: 0, y: 0, z: 0 },
				modelRotation: { x: 0, y: 0, z: 0, w: 1 },
				transformedModelBounds: model.bounds,
				modelOutsideBuildVolume: false,
				modelOverlapsSupportMargin: false,
				canEnterSupports: true,
				interactionMode: 'readonly',
				supportPointCount: 0,
				supportPoints: [],
				supportStructures: [],
				onTranslationChange: noop,
				onRotationChange: noop,
				onSupportPointPlaced: noop,
				onEnterSupports: noop,
				onBackToPrepare: noop,
				...previewProps,
				previewStatus: 'ready',
				previewLayerCount: 12,
				previewZHeightMm: 0.6,
				previewVolumeCubicMm: 1234
			}
		});

		expect(body).toContain('1.23 mL resin');
		expect(body).toContain('12 layers');
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
