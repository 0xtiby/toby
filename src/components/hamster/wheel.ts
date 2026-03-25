import { PALETTE } from "./palette.js";

/** A single colored pixel on the grid buffer */
export interface GridPixel {
	x: number;
	y: number;
	color: string; // hex color from PALETTE
}

/**
 * Compute wheel center and radii for a given grid size.
 * Radius is derived from height (the constrained axis) because
 * the aspect ratio correction stretches x-coordinates.
 */
export function computeWheelGeometry(width: number, height: number) {
	const cx = Math.floor(width / 2);
	const cy = Math.floor(height / 2);
	const outerRadius = Math.floor(height / 2) - 1;
	const innerRadius = Math.floor(outerRadius * 0.85);
	return { cx, cy, outerRadius, innerRadius };
}

/**
 * Generate all wheel pixels for a given grid size and spoke angle.
 *
 * Callers are responsible for clamping any out-of-bounds pixels
 * when aspectRatio > 1 causes x-coordinates to exceed grid width.
 *
 * @param cx - Center column in the grid
 * @param cy - Center row in the grid
 * @param outerRadius - Outer rim radius in grid cells
 * @param innerRadius - Inner rim radius in grid cells
 * @param spokeAngle - Current spoke rotation angle in radians
 * @param aspectRatio - X-axis stretch factor (default 1.0 for half-block mode)
 */
export function generateWheelPixels(
	cx: number,
	cy: number,
	outerRadius: number,
	innerRadius: number,
	spokeAngle: number,
	aspectRatio: number = 1.0,
): GridPixel[] {
	const pixels: GridPixel[] = [];

	// Outer rim — scaled angle steps, alternating bright/dim
	const outerSteps = Math.max(16, outerRadius * 8);
	for (let i = 0; i < outerSteps; i++) {
		const angle = (i / outerSteps) * 2 * Math.PI;
		const x = Math.round(cx + Math.cos(angle) * outerRadius * aspectRatio);
		const y = Math.round(cy + Math.sin(angle) * outerRadius);
		const color =
			i % 3 === 0 ? PALETTE.wheelBright : PALETTE.wheelDim;
		pixels.push({ x, y, color });
	}

	// Inner rim — scaled angle steps, every 3rd plotted
	const innerSteps = Math.max(12, innerRadius * 6);
	for (let i = 0; i < innerSteps; i += 3) {
		const angle = (i / innerSteps) * 2 * Math.PI;
		const x = Math.round(
			cx + Math.cos(angle) * innerRadius * aspectRatio,
		);
		const y = Math.round(cy + Math.sin(angle) * innerRadius);
		pixels.push({ x, y, color: PALETTE.wheelInner });
	}

	// 8 radial spokes, rotated by spokeAngle
	const spokeStep = Math.max(1, outerRadius / 8);
	for (let s = 0; s < 8; s++) {
		const angle = spokeAngle + (s / 8) * 2 * Math.PI;
		for (
			let r = outerRadius * 0.25;
			r <= outerRadius;
			r += spokeStep
		) {
			const x = Math.round(cx + Math.cos(angle) * r * aspectRatio);
			const y = Math.round(cy + Math.sin(angle) * r);
			pixels.push({ x, y, color: PALETTE.wheelSpoke });
		}
	}

	// Center hub — plus shape (manhattan distance <= 1)
	for (let dx = -1; dx <= 1; dx++) {
		for (let dy = -1; dy <= 1; dy++) {
			if (Math.abs(dx) + Math.abs(dy) <= 1) {
				pixels.push({ x: cx + dx, y: cy + dy, color: PALETTE.wheelHub });
			}
		}
	}

	return pixels;
}
