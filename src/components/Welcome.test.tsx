import { describe, it, expect, vi, afterEach } from "vitest";
import React from "react";
import { render, cleanup } from "ink-testing-library";
import Welcome from "./Welcome.js";

afterEach(() => {
	cleanup();
});

const ENTER = "\r";
const ARROW_DOWN = "\u001B[B";

function delay(ms = 100): Promise<void> {
	return new Promise((r) => setTimeout(r, ms));
}

describe("Welcome", () => {
	it("renders HamsterWheel, InfoPanel, and MainMenu in initial state", () => {
		const { lastFrame } = render(<Welcome version="1.0.0" />);
		const output = lastFrame()!;
		// InfoPanel version
		expect(output).toContain("toby v1.0.0");
		// Robot mascot is gone
		expect(output).not.toContain("● ●");
		// MainMenu items
		expect(output).toContain("plan");
		expect(output).toContain("build");
		expect(output).toContain("status");
		expect(output).toContain("config");
	});

	it("transitions to Plan component on plan selection", async () => {
		const { lastFrame, stdin } = render(<Welcome version="1.0.0" />);
		await delay();
		stdin.write(ENTER); // Select first item (plan)
		await delay();
		const output = lastFrame()!;
		// Plan component renders — should no longer show mascot
		expect(output).not.toContain("toby v1.0.0");
	});

	it("transitions to Build component on build selection", async () => {
		const { lastFrame, stdin } = render(<Welcome version="1.0.0" />);
		await delay();
		stdin.write(ARROW_DOWN); // Move to build
		await delay();
		stdin.write(ENTER);
		await delay();
		const output = lastFrame()!;
		expect(output).not.toContain("toby v1.0.0");
	});
});
