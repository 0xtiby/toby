import React from "react";
import { describe, it, expect } from "vitest";
import { render } from "ink-testing-library";
import InfoPanel from "./InfoPanel.js";
import type { ProjectStats } from "../lib/stats.js";

function makeStats(overrides: Partial<ProjectStats> = {}): ProjectStats {
	return {
		totalSpecs: 5,
		pending: 1,
		planned: 3,
		building: 0,
		done: 1,
		totalIterations: 12,
		totalTokens: 24512,
		...overrides,
	};
}

describe("InfoPanel", () => {
	it("renders version and stats when stats provided", () => {
		const { lastFrame } = render(
			<InfoPanel version="1.0.0" stats={makeStats()} />,
		);
		const output = lastFrame()!;
		expect(output).toContain("toby v1.0.0");
		expect(output).toContain("Specs");
		expect(output).toContain("5");
		expect(output).toContain("Planned");
		expect(output).toContain("3");
		expect(output).toContain("Done");
		expect(output).toContain("1");
		expect(output).toContain("Tokens");
		expect(output).toContain("24,512");
	});

	it("renders only version when stats is null", () => {
		const { lastFrame } = render(
			<InfoPanel version="1.0.0" stats={null} />,
		);
		const output = lastFrame()!;
		expect(output).toContain("toby v1.0.0");
		expect(output).not.toContain("Specs");
		expect(output).not.toContain("Tokens");
	});

	it("formats large token counts with thousands separators", () => {
		const { lastFrame } = render(
			<InfoPanel version="2.0.0" stats={makeStats({ totalTokens: 1234567 })} />,
		);
		const output = lastFrame()!;
		expect(output).toContain("1,234,567");
	});

	it("renders zero tokens as 0", () => {
		const { lastFrame } = render(
			<InfoPanel version="1.0.0" stats={makeStats({ totalTokens: 0 })} />,
		);
		const output = lastFrame()!;
		expect(output).toContain("Tokens");
		expect(output).toContain("0");
	});
});
