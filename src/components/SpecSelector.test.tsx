import { describe, it, expect, vi } from "vitest";
import React from "react";
import { render } from "ink-testing-library";
import SpecSelector from "./SpecSelector.js";
import type { Spec } from "../lib/specs.js";

function makeSpec(overrides: Partial<Spec> = {}): Spec {
	return {
		name: "01-auth",
		path: "/project/specs/01-auth.md",
		order: 1,
		status: "pending",
		...overrides,
	};
}

describe("SpecSelector", () => {
	it("renders all discovered specs", () => {
		const specs: Spec[] = [
			makeSpec({ name: "01-auth", order: 1 }),
			makeSpec({ name: "02-api", order: 2 }),
			makeSpec({ name: "03-ui", order: 3 }),
		];

		const { lastFrame } = render(
			<SpecSelector specs={specs} onSelect={vi.fn()} />,
		);

		const output = lastFrame()!;
		expect(output).toContain("01-auth");
		expect(output).toContain("02-api");
		expect(output).toContain("03-ui");
	});

	it("shows status next to each spec name", () => {
		const specs: Spec[] = [
			makeSpec({ name: "01-auth", status: "pending" }),
			makeSpec({ name: "02-api", status: "planned" }),
			makeSpec({ name: "03-ui", status: "done" }),
		];

		const { lastFrame } = render(
			<SpecSelector specs={specs} onSelect={vi.fn()} />,
		);

		const output = lastFrame()!;
		expect(output).toContain("[pending]");
		expect(output).toContain("[planned]");
		expect(output).toContain("[done]");
	});

	it("shows empty message when no specs", () => {
		const { lastFrame } = render(
			<SpecSelector specs={[]} onSelect={vi.fn()} />,
		);

		expect(lastFrame()!).toContain("No specs found");
	});

	it("shows selection header", () => {
		const specs: Spec[] = [makeSpec()];

		const { lastFrame } = render(
			<SpecSelector specs={specs} onSelect={vi.fn()} />,
		);

		expect(lastFrame()!).toContain("Select a spec to plan");
	});

	it("renders items with correct label format for selection", () => {
		const specs: Spec[] = [
			makeSpec({ name: "01-auth", status: "pending" }),
		];

		const { lastFrame } = render(
			<SpecSelector specs={specs} onSelect={vi.fn()} />,
		);

		// ink-select-input renders items with indicator; verify the label format
		const output = lastFrame()!;
		expect(output).toContain("01-auth");
		expect(output).toContain("[pending]");
	});
});
