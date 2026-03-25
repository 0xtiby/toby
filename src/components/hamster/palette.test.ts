import { describe, it, expect } from "vitest";
import { PALETTE } from "./palette.js";

describe("PALETTE", () => {
	it("contains all 15 color tokens", () => {
		expect(Object.keys(PALETTE)).toHaveLength(15);
	});

	it("has valid hex strings for all values", () => {
		for (const [token, hex] of Object.entries(PALETTE)) {
			expect(hex, `${token} should be a valid hex color`).toMatch(
				/^#[0-9a-f]{6}$/i,
			);
		}
	});
});
