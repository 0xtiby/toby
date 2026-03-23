import React from "react";
import { describe, it, expect } from "vitest";
import { render } from "ink-testing-library";
import StatusSummary from "./StatusSummary.js";
import type { ProjectStats } from "../lib/stats.js";

describe("StatusSummary", () => {
	it("renders nothing when stats is null", () => {
		const { lastFrame } = render(<StatusSummary stats={null} />);
		expect(lastFrame()).toBe("");
	});

	it("renders formatted inline row with correct numbers", () => {
		const stats: ProjectStats = {
			totalSpecs: 5,
			pending: 1,
			planned: 3,
			building: 0,
			done: 1,
			totalIterations: 12,
		};
		const { lastFrame } = render(<StatusSummary stats={stats} />);
		const output = lastFrame();
		expect(output).toContain("Specs: 5");
		expect(output).toContain("Planned: 3");
		expect(output).toContain("Built: 1");
		expect(output).toContain("Iterations: 12");
	});

	it("renders row with zeros when all stats are zero", () => {
		const stats: ProjectStats = {
			totalSpecs: 0,
			pending: 0,
			planned: 0,
			building: 0,
			done: 0,
			totalIterations: 0,
		};
		const { lastFrame } = render(<StatusSummary stats={stats} />);
		const output = lastFrame();
		expect(output).toContain("Specs: 0");
		expect(output).toContain("Iterations: 0");
	});
});
