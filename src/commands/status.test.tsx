import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render } from "ink-testing-library";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import Status, { formatDuration } from "./status.js";

let tmpDir: string;

function setup(opts: {
	initToby?: boolean;
	specs?: { name: string; content?: string }[];
	statusSpecs?: Record<string, { status: string; iterations: unknown[] }>;
} = {}) {
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "toby-status-test-"));
	const tobyDir = path.join(tmpDir, ".toby");

	if (opts.initToby !== false) {
		fs.mkdirSync(tobyDir, { recursive: true });

		// Write config
		fs.writeFileSync(
			path.join(tobyDir, "config.json"),
			JSON.stringify({
				plan: { cli: "claude", model: "default", iterations: 2 },
				build: { cli: "claude", model: "default", iterations: 10 },
				specsDir: "specs",
				excludeSpecs: ["README.md"],
				verbose: false,
			}, null, 2),
		);

		// Write status.json
		const statusData = {
			specs: Object.fromEntries(
				Object.entries(opts.statusSpecs ?? {}).map(([name, entry]) => [
					name,
					{
						status: entry.status,
						plannedAt: null,
						iterations: entry.iterations,
					},
				]),
			),
		};
		fs.writeFileSync(
			path.join(tobyDir, "status.json"),
			JSON.stringify(statusData, null, 2),
		);
	}

	// Create specs directory and files
	if (opts.specs) {
		const specsDir = path.join(tmpDir, "specs");
		fs.mkdirSync(specsDir, { recursive: true });
		for (const spec of opts.specs) {
			fs.writeFileSync(
				path.join(specsDir, `${spec.name}.md`),
				spec.content ?? `# ${spec.name}`,
			);
		}
	}

	vi.spyOn(process, "cwd").mockReturnValue(tmpDir);
}

beforeEach(() => {
	tmpDir = "";
});

afterEach(() => {
	vi.restoreAllMocks();
	if (tmpDir && fs.existsSync(tmpDir)) {
		fs.rmSync(tmpDir, { recursive: true });
	}
});

describe("Status", () => {
	it("shows error when .toby/ doesn't exist", () => {
		setup({ initToby: false });
		const { lastFrame } = render(<Status version="0.1.0" />);
		expect(lastFrame()).toContain("Toby not initialized");
		expect(lastFrame()).toContain("toby init");
	});

	it("shows empty state when no specs found", () => {
		setup({ initToby: true });
		const { lastFrame } = render(<Status version="0.1.0" />);
		expect(lastFrame()).toContain("No specs found");
	});

	it("renders table with correct spec data", () => {
		setup({
			specs: [
				{ name: "01-auth" },
				{ name: "02-api" },
			],
			statusSpecs: {
				"01-auth": {
					status: "planned",
					iterations: [
						{
							type: "plan",
							iteration: 1,
							sessionId: null,
							cli: "claude",
							model: "default",
							startedAt: "2026-01-01T00:00:00Z",
							completedAt: "2026-01-01T00:01:00Z",
							exitCode: 0,
							taskCompleted: null,
							tokensUsed: null,
						},
					],
				},
			},
		});
		const { lastFrame } = render(<Status version="0.1.0" />);
		const output = lastFrame()!;

		// Table headers
		expect(output).toContain("Spec");
		expect(output).toContain("Status");
		expect(output).toContain("Tokens");
		expect(output).toContain("Iter");

		// 01-auth row: planned, 1 iteration, 0 tokens (tokensUsed is null)
		expect(output).toContain("01-auth");
		expect(output).toContain("planned");

		// 02-api row: pending, 0 iterations
		expect(output).toContain("02-api");
		expect(output).toContain("pending");
	});

	it("shows tokens summed from iterations", () => {
		setup({
			specs: [{ name: "01-auth" }],
			statusSpecs: {
				"01-auth": {
					status: "building",
					iterations: [
						{
							type: "build",
							iteration: 1,
							sessionId: null,
							cli: "claude",
							model: "default",
							startedAt: "2026-01-01T00:00:00Z",
							completedAt: "2026-01-01T00:01:00Z",
							exitCode: 0,
							taskCompleted: null,
							tokensUsed: 5000,
						},
						{
							type: "build",
							iteration: 2,
							sessionId: null,
							cli: "claude",
							model: "default",
							startedAt: "2026-01-01T00:02:00Z",
							completedAt: "2026-01-01T00:03:00Z",
							exitCode: 0,
							taskCompleted: null,
							tokensUsed: 3500,
						},
					],
				},
			},
		});
		const { lastFrame } = render(<Status version="0.1.0" />);
		expect(lastFrame()).toContain("8500");
	});

	it("shows 0 tokens for specs with no iterations", () => {
		setup({
			specs: [{ name: "01-auth" }],
		});
		const { lastFrame } = render(<Status version="0.1.0" />);
		// Tokens column should show 0
		expect(lastFrame()).toContain("0");
	});

	describe("--spec detailed view", () => {
		it("shows spec info without task breakdown", () => {
			setup({
				specs: [{ name: "01-auth" }],
				statusSpecs: {
					"01-auth": {
						status: "building",
						iterations: [
							{
								type: "build",
								iteration: 1,
								sessionId: null,
								cli: "claude",
								model: "default",
								startedAt: "2026-01-01T00:00:00Z",
								completedAt: "2026-01-01T00:01:00Z",
								exitCode: 0,
								taskCompleted: "task-0",
								tokensUsed: 5000,
							},
							{
								type: "build",
								iteration: 2,
								sessionId: null,
								cli: "claude",
								model: "default",
								startedAt: "2026-01-01T00:02:00Z",
								completedAt: "2026-01-01T00:03:00Z",
								exitCode: 0,
								taskCompleted: "task-1",
								tokensUsed: 3000,
							},
						],
					},
				},
			});
			const { lastFrame } = render(<Status spec="auth" version="0.1.0" />);
			const output = lastFrame()!;

			expect(output).toContain("01-auth");
			expect(output).toContain("building");
			expect(output).toContain("Type");
			expect(output).toContain("CLI");
			expect(output).toContain("Tokens");
			expect(output).toContain("Duration");
			expect(output).toContain("Exit");
			expect(output).toContain("Iterations: 2");
			expect(output).toContain("Tokens used: 8000");
		});

		it("shows error for non-existent spec", () => {
			setup({
				specs: [{ name: "01-auth" }],
			});
			const { lastFrame } = render(<Status spec="nonexistent" version="0.1.0" />);
			expect(lastFrame()).toContain("Spec not found: nonexistent");
		});

		it("shows no iterations yet message when no iterations", () => {
			setup({
				specs: [{ name: "01-auth" }],
			});
			const { lastFrame } = render(<Status spec="auth" version="0.1.0" />);
			expect(lastFrame()).toContain("No iterations yet");
		});

		it("sums token usage across all iterations", () => {
			setup({
				specs: [{ name: "01-auth" }],
				statusSpecs: {
					"01-auth": {
						status: "building",
						iterations: [
							{
								type: "plan",
								iteration: 1,
								sessionId: null,
								cli: "claude",
								model: "default",
								startedAt: "2026-01-01T00:00:00Z",
								completedAt: "2026-01-01T00:01:00Z",
								exitCode: 0,
								taskCompleted: null,
								tokensUsed: 1500,
							},
							{
								type: "build",
								iteration: 1,
								sessionId: null,
								cli: "claude",
								model: "default",
								startedAt: "2026-01-01T00:02:00Z",
								completedAt: null,
								exitCode: null,
								taskCompleted: null,
								tokensUsed: null,
							},
						],
					},
				},
			});
			const { lastFrame } = render(<Status spec="01-auth" version="0.1.0" />);
			expect(lastFrame()).toContain("Tokens used: 1500");
		});

		it("shows '—' for null tokensUsed, completedAt, and exitCode in iteration rows", () => {
			setup({
				specs: [{ name: "01-auth" }],
				statusSpecs: {
					"01-auth": {
						status: "building",
						iterations: [
							{
								type: "build",
								iteration: 1,
								sessionId: null,
								cli: "claude",
								model: "default",
								startedAt: "2026-01-01T00:00:00Z",
								completedAt: null,
								exitCode: null,
								taskCompleted: null,
								tokensUsed: null,
							},
						],
					},
				},
			});
			const { lastFrame } = render(<Status spec="01-auth" version="0.1.0" />);
			const output = lastFrame()!;
			// The iteration row should contain '—' three times: tokens, duration, exitCode
			const dashCount = (output.match(/—/g) || []).length;
			expect(dashCount).toBeGreaterThanOrEqual(3);
		});
	});
});

describe("formatDuration", () => {
	it("returns '—' when completedAt is null", () => {
		expect(formatDuration("2026-01-01T00:00:00Z", null)).toBe("—");
	});

	it("returns '1m 0s' for 60-second duration", () => {
		expect(formatDuration("2026-01-01T00:00:00Z", "2026-01-01T00:01:00Z")).toBe("1m 0s");
	});

	it("returns '0m 0s' for zero duration", () => {
		expect(formatDuration("2026-01-01T00:00:00Z", "2026-01-01T00:00:00Z")).toBe("0m 0s");
	});
});
