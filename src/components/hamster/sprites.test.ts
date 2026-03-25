import { describe, it, expect } from "vitest";
import { PALETTE } from "./palette.js";
import {
	HAMSTER_BODY,
	FRAME_A_LEGS,
	FRAME_B_LEGS,
	FRAME_A,
	FRAME_B,
	HAMSTER_FRAMES,
} from "./sprites.js";

describe("sprites", () => {
	it("HAMSTER_FRAMES has exactly 2 entries", () => {
		expect(HAMSTER_FRAMES).toHaveLength(2);
	});

	it("HAMSTER_FRAMES references FRAME_A and FRAME_B", () => {
		expect(HAMSTER_FRAMES[0]).toBe(FRAME_A);
		expect(HAMSTER_FRAMES[1]).toBe(FRAME_B);
	});

	it("FRAME_A is composed of HAMSTER_BODY + FRAME_A_LEGS", () => {
		expect(FRAME_A).toEqual([...HAMSTER_BODY, ...FRAME_A_LEGS]);
	});

	it("FRAME_B is composed of HAMSTER_BODY + FRAME_B_LEGS", () => {
		expect(FRAME_B).toEqual([...HAMSTER_BODY, ...FRAME_B_LEGS]);
	});

	it("all color tokens in FRAME_A exist in PALETTE", () => {
		for (const pixel of FRAME_A) {
			expect(PALETTE).toHaveProperty(pixel[2]);
		}
	});

	it("all color tokens in FRAME_B exist in PALETTE", () => {
		for (const pixel of FRAME_B) {
			expect(PALETTE).toHaveProperty(pixel[2]);
		}
	});

	it("body pixels (rows <= 3) are identical between frames", () => {
		const bodyA = FRAME_A.filter((p) => p[1] <= 3);
		const bodyB = FRAME_B.filter((p) => p[1] <= 3);
		expect(bodyA).toEqual(bodyB);
	});

	it("leg pixels (rows >= 4) differ between frames", () => {
		const legsA = FRAME_A.filter((p) => p[1] >= 4);
		const legsB = FRAME_B.filter((p) => p[1] >= 4);
		expect(legsA).not.toEqual(legsB);
	});

	it("each pixel is a 3-tuple of [number, number, string]", () => {
		for (const pixel of [...FRAME_A, ...FRAME_B]) {
			expect(pixel).toHaveLength(3);
			expect(typeof pixel[0]).toBe("number");
			expect(typeof pixel[1]).toBe("number");
			expect(typeof pixel[2]).toBe("string");
		}
	});
});
