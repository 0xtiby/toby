import React from "react";
import { describe, it, expect } from "vitest";
import { render } from "ink-testing-library";
import Mascot from "./Mascot.js";

describe("Mascot", () => {
	it("renders ASCII robot art", () => {
		const { lastFrame } = render(<Mascot version="1.2.3" />);
		const output = lastFrame()!;
		expect(output).toContain("● ●");
		expect(output).toContain("▬");
		expect(output).toContain("┌─────┐");
		expect(output).toContain("└─┬─┬─┘");
	});

	it("displays version string next to robot", () => {
		const { lastFrame } = render(<Mascot version="1.2.3" />);
		const output = lastFrame()!;
		expect(output).toContain("toby v1.2.3");
	});

	it("renders version on the mouth line", () => {
		const { lastFrame } = render(<Mascot version="0.1.0" />);
		const lines = lastFrame()!.split("\n");
		const versionLine = lines.find((l) => l.includes("▬"));
		expect(versionLine).toContain("toby v0.1.0");
	});
});
