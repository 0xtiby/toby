import { describe, it, expect, vi, afterEach } from "vitest";
import React from "react";
import { render, cleanup } from "ink-testing-library";
import MainMenu from "./MainMenu.js";

afterEach(() => {
	cleanup();
});

const ENTER = "\r";
const ARROW_DOWN = "\u001B[B";

function delay(ms = 100): Promise<void> {
	return new Promise((r) => setTimeout(r, ms));
}

describe("MainMenu", () => {
	it("renders all 4 menu items", () => {
		const { lastFrame } = render(<MainMenu onSelect={vi.fn()} />);
		const output = lastFrame()!;
		expect(output).toContain("plan");
		expect(output).toContain("build");
		expect(output).toContain("status");
		expect(output).toContain("config");
	});

	it("renders descriptions in dim text", () => {
		const { lastFrame } = render(<MainMenu onSelect={vi.fn()} />);
		const output = lastFrame()!;
		expect(output).toContain("Plan specs with AI loop engine");
		expect(output).toContain("Build tasks one-per-spawn with AI");
		expect(output).toContain("Show project status");
		expect(output).toContain("Manage configuration");
	});

	it("calls onSelect with 'plan' when first item selected", async () => {
		const onSelect = vi.fn();
		const { stdin } = render(<MainMenu onSelect={onSelect} />);
		await delay();
		stdin.write(ENTER);
		await delay();
		expect(onSelect).toHaveBeenCalledWith("plan");
	});

	it("calls onSelect with correct value for non-first item", async () => {
		const onSelect = vi.fn();
		const { stdin } = render(<MainMenu onSelect={onSelect} />);
		await delay();
		stdin.write(ARROW_DOWN);
		await delay();
		stdin.write(ENTER);
		await delay();
		expect(onSelect).toHaveBeenCalledWith("build");
	});
});
