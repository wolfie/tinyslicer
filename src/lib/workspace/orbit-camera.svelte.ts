const ORBIT_SENSITIVITY = 0.007;
const MIN_PITCH = -1.38;
const MAX_PITCH = 1.45;

export class OrbitCamera {
	yaw = $state(-0.86);
	pitch = $state(0.58);
	orbiting = $state(false);

	#activePointer: number | null = null;
	#previousPointer = { x: 0, y: 0 };

	start = (event: PointerEvent) => {
		if (event.button !== 1) return;

		event.preventDefault();
		const canvas = event.currentTarget as HTMLCanvasElement;
		canvas.setPointerCapture(event.pointerId);
		this.#activePointer = event.pointerId;
		this.orbiting = true;
		this.#previousPointer = { x: event.clientX, y: event.clientY };
	};

	update = (event: PointerEvent) => {
		if (!this.orbiting || this.#activePointer !== event.pointerId) return;

		const deltaX = event.clientX - this.#previousPointer.x;
		const deltaY = event.clientY - this.#previousPointer.y;
		this.yaw -= deltaX * ORBIT_SENSITIVITY;
		this.pitch = Math.max(MIN_PITCH, Math.min(MAX_PITCH, this.pitch + deltaY * ORBIT_SENSITIVITY));
		this.#previousPointer = { x: event.clientX, y: event.clientY };
	};

	stop = (event: PointerEvent) => {
		if (this.#activePointer !== event.pointerId) return;

		const canvas = event.currentTarget as HTMLCanvasElement;
		if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
		this.#activePointer = null;
		this.orbiting = false;
	};
}
