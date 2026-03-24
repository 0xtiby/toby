import { describe, it, expect, vi, afterEach } from "vitest";
import React from "react";
import { render, cleanup } from "ink-testing-library";
import MultiSpecSelector from "./MultiSpecSelector.js";
import type { Spec } from "../lib/specs.js";

afterEach(() => {
	cleanup();
});

function makeSpec(overrides: Partial<Spec> & { name: string }): Spec {
	return {
		path: `/specs/${overrides.name}.md`,
		order: { num: 1, suffix: null },
		status: "pending",
		...overrides,
	};
}

const specs: Spec[] = [
	makeSpec({ name: "01-auth", order: { num: 1, suffix: null }, status: "pending" }),
	makeSpec({ name: "02-api", order: { num: 2, suffix: null }, status: "planned" }),
	makeSpec({ name: "03-ui", order: { num: 3, suffix: null }, status: "done" }),
];

const ARROW_DOWN = "\u001B[B";
const ARROW_UP = "\u001B[A";
const SPACE = " ";
const ENTER = "\r";

function delay(ms = 100): Promise<void> {
	return new Promise((r) => setTimeout(r, ms));
}

describe("MultiSpecSelector", () => {
	it("renders all specs with ○ checkboxes (initially unselected)", () => {
		const { lastFrame } = render(
			<MultiSpecSelector specs={specs} onConfirm={vi.fn()} />,
		);
		const output = lastFrame()!;
		expect(output).toContain("○ 01-auth");
		expect(output).toContain("○ 02-api");
		expect(output).toContain("○ 03-ui");
	});

	it("shows Select All item at top with divider", () => {
		const { lastFrame } = render(
			<MultiSpecSelector specs={specs} onConfirm={vi.fn()} />,
		);
		const output = lastFrame()!;
		expect(output).toContain("Select All");
		expect(output).toContain("──────────────");
	});

	it("shows status badges next to each spec name", () => {
		const { lastFrame } = render(
			<MultiSpecSelector specs={specs} onConfirm={vi.fn()} />,
		);
		const output = lastFrame()!;
		expect(output).toContain("[pending]");
		expect(output).toContain("[planned]");
		expect(output).toContain("[done]");
	});

	it("shows default title 'Select specs to plan:'", () => {
		const { lastFrame } = render(
			<MultiSpecSelector specs={specs} onConfirm={vi.fn()} />,
		);
		expect(lastFrame()!).toContain("Select specs to plan:");
	});

	it("shows custom title when provided", () => {
		const { lastFrame } = render(
			<MultiSpecSelector specs={specs} onConfirm={vi.fn()} title="Select specs to build:" />,
		);
		expect(lastFrame()!).toContain("Select specs to build:");
	});

	it("shows empty message when no specs", () => {
		const { lastFrame } = render(
			<MultiSpecSelector specs={[]} onConfirm={vi.fn()} />,
		);
		expect(lastFrame()!).toContain("No specs found");
	});

	it("space toggles individual spec selection", async () => {
		const { lastFrame, stdin } = render(
			<MultiSpecSelector specs={specs} onConfirm={vi.fn()} />,
		);
		await delay();
		// Move down to first spec
		stdin.write(ARROW_DOWN);
		await delay();
		// Verify cursor moved
		let output = lastFrame()!;
		expect(output).toContain("❯");
		// Toggle selection
		stdin.write(SPACE);
		await delay();
		output = lastFrame()!;
		expect(output).toContain("◉ 01-auth");
		expect(output).toContain("○ 02-api");
	});

	it("enter with selections calls onConfirm with selected specs", async () => {
		const onConfirm = vi.fn();
		const { stdin } = render(
			<MultiSpecSelector specs={specs} onConfirm={onConfirm} />,
		);
		await delay();
		// Move to first spec and select
		stdin.write(ARROW_DOWN);
		await delay();
		stdin.write(SPACE);
		await delay();
		// Confirm
		stdin.write(ENTER);
		await delay();
		expect(onConfirm).toHaveBeenCalledTimes(1);
		expect(onConfirm.mock.calls[0][0]).toHaveLength(1);
		expect(onConfirm.mock.calls[0][0][0].name).toBe("01-auth");
	});

	it("enter with no selections shows yellow warning, does NOT call onConfirm", async () => {
		const onConfirm = vi.fn();
		const { lastFrame, stdin } = render(
			<MultiSpecSelector specs={specs} onConfirm={onConfirm} />,
		);
		await delay();
		stdin.write(ENTER);
		await delay();
		expect(lastFrame()!).toContain("Please select at least one spec");
		expect(onConfirm).not.toHaveBeenCalled();
	});

	it("Select All toggles all specs on/off", async () => {
		const { lastFrame, stdin } = render(
			<MultiSpecSelector specs={specs} onConfirm={vi.fn()} />,
		);
		await delay();
		// Cursor starts on Select All, press space
		stdin.write(SPACE);
		await delay();
		let output = lastFrame()!;
		expect(output).toContain("◉ 01-auth");
		expect(output).toContain("◉ 02-api");
		expect(output).toContain("◉ 03-ui");
		expect(output).toContain("◉ Select All");

		// Toggle off
		stdin.write(SPACE);
		await delay();
		output = lastFrame()!;
		expect(output).toContain("○ 01-auth");
		expect(output).toContain("○ 02-api");
		expect(output).toContain("○ 03-ui");
	});

	it("deselecting one spec after Select All auto-unchecks Select All", async () => {
		const { lastFrame, stdin } = render(
			<MultiSpecSelector specs={specs} onConfirm={vi.fn()} />,
		);
		await delay();
		// Select all
		stdin.write(SPACE);
		await delay();
		// Move to first spec and deselect it
		stdin.write(ARROW_DOWN);
		await delay();
		stdin.write(SPACE);
		await delay();
		const output = lastFrame()!;
		expect(output).toContain("○ Select All");
		expect(output).toContain("○ 01-auth");
		expect(output).toContain("◉ 02-api");
	});
});
