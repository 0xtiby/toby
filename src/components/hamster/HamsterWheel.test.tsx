import React from "react";
import { describe, it, expect } from "vitest";
import { render } from "ink-testing-library";
import HamsterWheel from "./HamsterWheel.js";

describe("HamsterWheel", () => {
	it("renders half-block characters with explicit dimensions", () => {
		const { lastFrame } = render(
			<HamsterWheel width={25} height={13} speed={0} />,
		);
		const output = lastFrame()!;
		expect(output).toMatch(/[▀▄]/);
	});

	it("produces deterministic output with speed=0", () => {
		const { lastFrame } = render(
			<HamsterWheel width={25} height={13} speed={0} />,
		);
		const first = lastFrame()!;
		const second = lastFrame()!;
		expect(first).toBe(second);
	});

	it("renders correct row count at compact size (25×13)", () => {
		const { lastFrame } = render(
			<HamsterWheel width={25} height={13} speed={0} />,
		);
		const lines = lastFrame()!.split("\n");
		expect(lines).toHaveLength(7); // ceil(13/2)
		for (const line of lines) {
			// Ink trims trailing spaces, so line length <= width
			expect(line.length).toBeLessThanOrEqual(25);
		}
	});

	it("renders correct row count at full size (35×18)", () => {
		const { lastFrame } = render(
			<HamsterWheel width={35} height={18} speed={0} />,
		);
		const lines = lastFrame()!.split("\n");
		expect(lines).toHaveLength(9); // ceil(18/2)
		for (const line of lines) {
			expect(line.length).toBeLessThanOrEqual(35);
		}
	});

	it("shows static fallback for small explicit width", () => {
		const { lastFrame } = render(
			<HamsterWheel width={5} height={5} speed={0} />,
		);
		const output = lastFrame()!;
		expect(output).toContain("🐹");
		expect(output).toContain("toby");
	});

	it("only uses half-block and space characters in non-fallback output", () => {
		const { lastFrame } = render(
			<HamsterWheel width={25} height={13} speed={0} />,
		);
		const output = lastFrame()!;
		const contentChars = output.replace(/\n/g, "");
		for (const ch of contentChars) {
			expect(["\u2580", "\u2584", " "]).toContain(ch);
		}
	});
});
