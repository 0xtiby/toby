import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render } from "ink-testing-library";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import Status from "./status.js";

let tmpDir: string;

function setup(opts: {
	initToby?: boolean;
	specs?: { name: string; content?: string }[];
	statusSpecs?: Record<string, { status: string; iterations: unknown[] }>;
	prds?: Record<string, { tasks: { status: string }[] }>;
} = {}) {
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "toby-status-test-"));
	const tobyDir = path.join(tmpDir, ".toby");

	if (opts.initToby !== false) {
		fs.mkdirSync(tobyDir, { recursive: true });
		fs.mkdirSync(path.join(tobyDir, "prd"), { recursive: true });

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

	// Create PRD files
	if (opts.prds) {
		const prdDir = path.join(tobyDir, "prd");
		fs.mkdirSync(prdDir, { recursive: true });
		for (const [name, data] of Object.entries(opts.prds)) {
			const prd = {
				spec: name,
				createdAt: "2026-01-01T00:00:00Z",
				tasks: data.tasks.map((t, i) => ({
					id: `task-${i}`,
					title: `Task ${i}`,
					description: "desc",
					acceptanceCriteria: [],
					files: [],
					dependencies: [],
					status: t.status,
					priority: i + 1,
				})),
			};
			fs.writeFileSync(
				path.join(prdDir, `${name}.json`),
				JSON.stringify(prd, null, 2),
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
			prds: {
				"01-auth": {
					tasks: [
						{ status: "done" },
						{ status: "done" },
						{ status: "pending" },
					],
				},
			},
		});
		const { lastFrame } = render(<Status version="0.1.0" />);
		const output = lastFrame()!;

		// Table headers
		expect(output).toContain("Spec");
		expect(output).toContain("Status");
		expect(output).toContain("Tasks");
		expect(output).toContain("Iter");

		// 01-auth row: planned, 2/3 done, 1 iteration
		expect(output).toContain("01-auth");
		expect(output).toContain("planned");
		expect(output).toContain("2/3");

		// 02-api row: pending, no prd, 0 iterations
		expect(output).toContain("02-api");
		expect(output).toContain("pending");
		expect(output).toContain("—");
	});

	it("shows — for specs without prd.json", () => {
		setup({
			specs: [{ name: "01-auth" }],
		});
		const { lastFrame } = render(<Status version="0.1.0" />);
		expect(lastFrame()).toContain("—");
	});

	describe("--spec detailed view", () => {
		it("renders task list with status icons", () => {
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
				prds: {
					"01-auth": {
						tasks: [
							{ status: "done" },
							{ status: "in_progress" },
							{ status: "pending" },
							{ status: "blocked" },
						],
					},
				},
			});
			const { lastFrame } = render(<Status spec="auth" version="0.1.0" />);
			const output = lastFrame()!;

			expect(output).toContain("01-auth");
			expect(output).toContain("building");
			expect(output).toContain("✓ done");
			expect(output).toContain("● in_progress");
			expect(output).toContain("○ pending");
			expect(output).toContain("○ blocked");
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

		it("shows no-tasks message when no prd exists", () => {
			setup({
				specs: [{ name: "01-auth" }],
			});
			const { lastFrame } = render(<Status spec="auth" version="0.1.0" />);
			expect(lastFrame()).toContain("No tasks");
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
				prds: {
					"01-auth": {
						tasks: [{ status: "pending" }],
					},
				},
			});
			const { lastFrame } = render(<Status spec="01-auth" version="0.1.0" />);
			expect(lastFrame()).toContain("Tokens used: 1500");
		});
	});
});
