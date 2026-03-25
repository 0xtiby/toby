import { describe, it, expect } from "vitest";
import { PALETTE } from "./palette.js";

describe("PALETTE", () => {
	it("contains all 16 color tokens", () => {
		expect(Object.keys(PALETTE)).toHaveLength(16);
	});

	it("has valid hex strings for all values", () => {
		for (const [token, hex] of Object.entries(PALETTE)) {
			expect(hex, `${token} should be a valid hex color`).toMatch(
				/^#[0-9a-f]{6}$/i,
			);
		}
	});

	it("has correct hamster colors", () => {
		expect(PALETTE.body).toBe("#d4883c");
		expect(PALETTE.bodyLight).toBe("#e8a85c");
		expect(PALETTE.bodyDark).toBe("#b06828");
		expect(PALETTE.belly).toBe("#f0d8b0");
		expect(PALETTE.ear).toBe("#ff8899");
		expect(PALETTE.earInner).toBe("#ff6680");
		expect(PALETTE.eye).toBe("#1a1a2e");
		expect(PALETTE.eyeShine).toBe("#ffffff");
		expect(PALETTE.cheek).toBe("#ff9977");
		expect(PALETTE.feet).toBe("#c47830");
		expect(PALETTE.tail).toBe("#b06828");
	});

	it("has correct wheel colors", () => {
		expect(PALETTE.wheelBright).toBe("#8888aa");
		expect(PALETTE.wheelDim).toBe("#555577");
		expect(PALETTE.wheelInner).toBe("#444466");
		expect(PALETTE.wheelSpoke).toBe("#3a3a55");
		expect(PALETTE.wheelHub).toBe("#7777aa");
	});
});
