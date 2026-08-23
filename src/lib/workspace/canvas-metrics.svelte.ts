export class CanvasMetrics {
	width = $state(0);
	height = $state(0);
	dpr = $state(1);

	observe = (canvas: HTMLCanvasElement) => {
		const update = () => {
			const bounds = canvas.getBoundingClientRect();
			this.width = bounds.width;
			this.height = bounds.height;
			this.dpr = Math.min(window.devicePixelRatio || 1, 2);
		};

		const resizeObserver = new ResizeObserver(update);
		resizeObserver.observe(canvas);
		update();

		return () => resizeObserver.disconnect();
	};
}
