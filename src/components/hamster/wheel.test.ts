import { describe, it, expect } from "vitest";
import { generateWheelPixels, computeWheelGeometry } from "./wheel.js";
import { PALETTE } from "./palette.js";

describe("computeWheelGeometry", () => {
	it("returns correct geometry for 25x13 grid", () => {
		const g = computeWheelGeometry(25, 13);
		expect(g).toEqual({ cx: 12, cy: 6, outerRadius: 5, innerRadius: 4 });
	});

	it("scales with height=20", () => {
		const g = computeWheelGeometry(40, 20);
		expect(g.outerRadius).toBe(9);
		expect(g.innerRadius).toBe(Math.floor(9 * 0.85));
	});

	it("scales with small height=7", () => {
		const g = computeWheelGeometry(15, 7);
		expect(g.outerRadius).toBe(2);
		expect(g.cx).toBe(7);
		expect(g.cy).toBe(3);
	});
});

describe("generateWheelPixels", () => {
	it("returns non-empty array for valid inputs", () => {
		const pixels = generateWheelPixels(15, 7, 6, 5, 0);
		expect(pixels.length).toBeGreaterThan(0);
	});

	it("all pixel colors are valid PALETTE hex values", () => {
		const paletteValues = new Set(Object.values(PALETTE));
		const pixels = generateWheelPixels(15, 7, 6, 5, 0);
		for (const p of pixels) {
			expect(paletteValues.has(p.color)).toBe(true);
		}
	});

	it("all pixels are within bounds for standard geometry", () => {
		const width = 30;
		const height = 13;
		const { cx, cy, outerRadius, innerRadius } = computeWheelGeometry(
			width,
			height,
		);
		const pixels = generateWheelPixels(
			cx,
			cy,
			outerRadius,
			innerRadius,
			0,
		);
		for (const p of pixels) {
			expect(p.x).toBeGreaterThanOrEqual(0);
			expect(p.x).toBeLessThan(width);
			expect(p.y).toBeGreaterThanOrEqual(0);
			expect(p.y).toBeLessThan(height);
		}
	});

	it("spoke rotation changes spoke pixels but not rim/hub", () => {
		const pixels0 = generateWheelPixels(15, 7, 6, 5, 0);
		const pixels1 = generateWheelPixels(15, 7, 6, 5, 0.15);

		// Outer rim steps = max(16, 6*8) = 48
		// Inner rim steps = max(12, 5*6) = 30, every 3rd = 10 pixels
		// Hub = 5 pixels
		// These are the first 48 + 10 pixels and the last 5
		const outerSteps = Math.max(16, 6 * 8);
		const innerPlotted = Math.ceil(Math.max(12, 5 * 6) / 3);
		const hubCount = 5;
		const rimInnerCount = outerSteps + innerPlotted;

		// Rim pixels (outer + inner) should be identical
		const rim0 = pixels0.slice(0, rimInnerCount);
		const rim1 = pixels1.slice(0, rimInnerCount);
		expect(rim0).toEqual(rim1);

		// Hub pixels (last 5) should be identical
		const hub0 = pixels0.slice(-hubCount);
		const hub1 = pixels1.slice(-hubCount);
		expect(hub0).toEqual(hub1);

		// Spoke pixels should differ
		const spokes0 = pixels0.slice(rimInnerCount, -hubCount);
		const spokes1 = pixels1.slice(rimInnerCount, -hubCount);
		expect(spokes0).not.toEqual(spokes1);
	});

	it("contains hub pixels at center", () => {
		const pixels = generateWheelPixels(15, 7, 6, 5, 0);
		const hubPixels = pixels.filter((p) => p.color === PALETTE.wheelHub);
		expect(hubPixels).toHaveLength(5);
		expect(hubPixels).toContainEqual({ x: 15, y: 7, color: PALETTE.wheelHub });
	});
});
