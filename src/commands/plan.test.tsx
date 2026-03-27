import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "ink-testing-library";

vi.mock("../lib/config.js", () => ({
	loadConfig: vi.fn(),
	resolveCommandConfig: vi.fn(),
}));

vi.mock("../lib/specs.js", () => ({
	discoverSpecs: vi.fn(),
	filterByStatus: vi.fn(),
	findSpec: vi.fn(),
}));

vi.mock("../lib/template.js", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../lib/template.js")>();
	return {
		...actual,
		loadPrompt: vi.fn(),
	};
});

vi.mock("../lib/loop.js", () => ({
	runLoop: vi.fn(),
}));

vi.mock("../lib/status.js", () => ({
	readStatus: vi.fn(),
	writeStatus: vi.fn(),
	addIteration: vi.fn(),
	updateSpecStatus: vi.fn(),
}));

vi.mock("../lib/paths.js", () => ({
	ensureLocalDir: vi.fn(),
}));

vi.mock("../lib/transcript.js", () => {
	const openTranscript = vi.fn();
	return {
		openTranscript,
		withTranscript: async (options: Record<string, unknown>, externalWriter: unknown, fn: (w: unknown) => Promise<unknown>) => {
			const owns = externalWriter === undefined;
			const writer = externalWriter !== undefined
				? externalWriter
				: ((options.flags as Record<string, unknown>).transcript ?? (options.config as Record<string, unknown>).transcript)
					? openTranscript({
						command: options.command,
						specName: options.specName,
						session: (options.flags as Record<string, unknown>).session,
						verbose: (options.flags as Record<string, unknown>).verbose || (options.config as Record<string, unknown>).verbose,
					})
					: null;
			try {
				return await fn(writer);
			} finally {
				if (owns) (writer as { close?: () => void })?.close?.();
			}
		},
	};
});

import { loadConfig, resolveCommandConfig } from "../lib/config.js";
import { discoverSpecs, filterByStatus, findSpec } from "../lib/specs.js";
import { loadPrompt, computeCliVars, resolveTemplateVars, computeSpecSlug } from "../lib/template.js";
import { runLoop } from "../lib/loop.js";
import type { LoopOptions } from "../lib/loop.js";
import { readStatus, writeStatus, addIteration, updateSpecStatus } from "../lib/status.js";
import { openTranscript } from "../lib/transcript.js";
import { executePlan, executePlanAll } from "./plan.js";
import { AbortError } from "../lib/errors.js";
import Plan from "./plan.js";
import type { PlanFlags } from "./plan.js";

const makeSpec = (name: string, num: number, status: "pending" | "planned" | "building" | "done") => ({
	name,
	path: `/project/specs/${name}.md`,
	order: { num, suffix: null },
	status,
});

const mockLoadConfig = vi.mocked(loadConfig);
const mockResolveCommandConfig = vi.mocked(resolveCommandConfig);
const mockDiscoverSpecs = vi.mocked(discoverSpecs);
const mockFilterByStatus = vi.mocked(filterByStatus);
const mockFindSpec = vi.mocked(findSpec);
const mockLoadPrompt = vi.mocked(loadPrompt);
const mockRunLoop = vi.mocked(runLoop);
const mockReadStatus = vi.mocked(readStatus);
const mockWriteStatus = vi.mocked(writeStatus);
const mockAddIteration = vi.mocked(addIteration);
const mockUpdateSpecStatus = vi.mocked(updateSpecStatus);
const mockOpenTranscript = vi.mocked(openTranscript);
const defaultFlags: PlanFlags = {
	spec: "auth",
	all: false,
	iterations: undefined,
	verbose: false,
	cli: undefined,
};

function setupDefaults() {
	mockLoadConfig.mockReturnValue({
		plan: { cli: "claude", model: "default", iterations: 2 },
		build: { cli: "claude", model: "default", iterations: 10 },
		specsDir: "specs",
		excludeSpecs: ["README.md"],
		verbose: false,
		transcript: false,
		templateVars: {},
	});

	mockResolveCommandConfig.mockReturnValue({
		cli: "claude",
		model: "default",
		iterations: 2,
	});

	const spec = {
		name: "01-auth",
		path: "/project/specs/01-auth.md",
		order: { num: 1, suffix: null },
		status: "pending" as const,
	};

	mockDiscoverSpecs.mockReturnValue([spec]);
	mockFilterByStatus.mockImplementation((specs, status) =>
		specs.filter((s) => s.status === status),
	);
	mockFindSpec.mockReturnValue(spec);
	mockLoadPrompt.mockReturnValue("Plan prompt for 01-auth");
	mockReadStatus.mockReturnValue({ specs: {} });
	mockAddIteration.mockImplementation((status) => status);
	mockUpdateSpecStatus.mockImplementation((status) => status);

	mockRunLoop.mockImplementation(async (options: LoopOptions) => {
		const iterResult = {
			iteration: 1,
			sessionId: "sess-1",
			exitCode: 0,
			tokensUsed: 150,
			model: "claude-sonnet-4-6",
			durationMs: 1000,
			sentinelDetected: false,
		};
		options.onIterationComplete?.(iterResult);
		return {
			iterations: [iterResult],
			stopReason: "max_iterations" as const,
		};
	});
}

describe("executePlan", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		setupDefaults();
	});

	it("calls runLoop with correct config-derived options", async () => {
		await executePlan(defaultFlags, {}, "/project");

		expect(mockRunLoop).toHaveBeenCalledOnce();
		const opts = mockRunLoop.mock.calls[0][0];
		expect(opts.maxIterations).toBe(2);
		expect(opts.cli).toBe("claude");
		expect(opts.cwd).toBe("/project");
		expect(opts.continueSession).toBe(true);
	});

	it("--iterations flag sets maxIterations on runLoop call", async () => {
		mockResolveCommandConfig.mockReturnValue({
			cli: "claude",
			model: "default",
			iterations: 5,
		});

		await executePlan({ ...defaultFlags, iterations: 5 }, {}, "/project");

		expect(mockResolveCommandConfig).toHaveBeenCalledWith(
			expect.anything(),
			"plan",
			expect.objectContaining({ iterations: 5 }),
		);
		expect(mockRunLoop.mock.calls[0][0].maxIterations).toBe(5);
	});

	it("--cli flag selects the correct AI CLI spawner", async () => {
		mockResolveCommandConfig.mockReturnValue({
			cli: "codex",
			model: "default",
			iterations: 2,
		});

		await executePlan({ ...defaultFlags, cli: "codex" }, {}, "/project");

		expect(mockResolveCommandConfig).toHaveBeenCalledWith(
			expect.anything(),
			"plan",
			expect.objectContaining({ cli: "codex" }),
		);
		expect(mockRunLoop.mock.calls[0][0].cli).toBe("codex");
	});

	it("prompt template receives correct substitution variables", async () => {
		await executePlan(defaultFlags, {}, "/project");

		// getPrompt is called inside runLoop; we capture it via the mock
		const getPrompt = mockRunLoop.mock.calls[0][0].getPrompt;
		getPrompt(1);

		expect(mockLoadPrompt).toHaveBeenCalledWith(
			"PROMPT_PLAN",
			{
				SPEC_NAME: "01-auth",
				SPEC_SLUG: "auth",
				ITERATION: "1",
				SPEC_INDEX: "1",
				SPEC_COUNT: "1",
				SESSION: "auth",
				SPECS: "01-auth",
				SPECS_DIR: "specs",
				},
			{ cwd: "/project" },
		);
	});

	it("status is updated after each iteration completes", async () => {
		await executePlan(defaultFlags, {}, "/project");

		expect(mockAddIteration).toHaveBeenCalledWith(
			expect.anything(),
			"01-auth",
			expect.objectContaining({
				type: "plan",
				iteration: 1,
				sessionId: "sess-1",
				cli: "claude",
			}),
		);
		// writeStatus called once for iteration, once for final status update
		expect(mockWriteStatus).toHaveBeenCalledTimes(2);
	});

	it("spec status transitions to planned on completion", async () => {
		await executePlan(defaultFlags, {}, "/project");

		expect(mockUpdateSpecStatus).toHaveBeenCalledWith(
			expect.anything(),
			"01-auth",
			"planned",
		);
	});

	it("error shown when spec not found", async () => {
		mockFindSpec.mockReturnValue(undefined);

		await expect(
			executePlan({ ...defaultFlags, spec: "nonexistent" }, {}, "/project"),
		).rejects.toThrow("Spec 'nonexistent' not found");

		expect(mockRunLoop).not.toHaveBeenCalled();
	});

	it("error shown when no specs found", async () => {
		mockDiscoverSpecs.mockReturnValue([]);

		await expect(
			executePlan(defaultFlags, {}, "/project"),
		).rejects.toThrow("No specs found in specs/");

		expect(mockRunLoop).not.toHaveBeenCalled();
	});

	it("SESSION defaults to computeSpecSlug(specName)", async () => {
		await executePlan(defaultFlags, {}, "/project");

		const getPrompt = mockRunLoop.mock.calls[0][0].getPrompt;
		getPrompt(1);

		expect(mockLoadPrompt).toHaveBeenCalledWith(
			"PROMPT_PLAN",
			expect.objectContaining({ SESSION: "auth" }),
			{ cwd: "/project" },
		);
	});

	it("--session flag overrides default session value", async () => {
		await executePlan({ ...defaultFlags, session: "my-session" }, {}, "/project");

		const getPrompt = mockRunLoop.mock.calls[0][0].getPrompt;
		getPrompt(1);

		expect(mockLoadPrompt).toHaveBeenCalledWith(
			"PROMPT_PLAN",
			expect.objectContaining({ SESSION: "my-session" }),
			{ cwd: "/project" },
		);
	});

	it("resolves config templateVars with CLI var interpolation", async () => {
		mockLoadConfig.mockReturnValue({
			plan: { cli: "claude", model: "default", iterations: 2 },
			build: { cli: "claude", model: "default", iterations: 10 },
			specsDir: "specs",
			excludeSpecs: ["README.md"],
			verbose: false,
			transcript: false,
			templateVars: { PRD_PATH: ".toby/{{SPEC_NAME}}.prd.json" },
		});

		await executePlan(defaultFlags, {}, "/project");

		const getPrompt = mockRunLoop.mock.calls[0][0].getPrompt;
		getPrompt(1);

		expect(mockLoadPrompt).toHaveBeenCalledWith(
			"PROMPT_PLAN",
			expect.objectContaining({
				PRD_PATH: ".toby/01-auth.prd.json",
				SPEC_NAME: "01-auth",
			}),
			{ cwd: "/project" },
		);
	});

	describe("refinement mode", () => {
		it("detects refinement when status is planned", async () => {
			mockReadStatus.mockReturnValue({
				specs: {
					"01-auth": {
						status: "planned",
						plannedAt: null,
						iterations: [
							{ type: "plan", iteration: 1, sessionId: "s1", cli: "claude", model: "default", startedAt: "2026-03-19T00:00:00.000Z", completedAt: "2026-03-19T00:00:00.000Z", exitCode: 0, taskCompleted: null, tokensUsed: 100 },
						],
					},
				},
			});

			const onRefinement = vi.fn();
			await executePlan(defaultFlags, { onRefinement }, "/project");

			expect(onRefinement).toHaveBeenCalledWith("01-auth");
		});

		it("iteration numbering continues from last recorded iteration", async () => {
			mockReadStatus.mockReturnValue({
				specs: {
					"01-auth": {
						status: "planned",
						plannedAt: null,
						iterations: [
							{ type: "plan", iteration: 1, sessionId: "s1", cli: "claude", model: "default", startedAt: "2026-03-19T00:00:00.000Z", completedAt: "2026-03-19T00:00:00.000Z", exitCode: 0, taskCompleted: null, tokensUsed: 100 },
							{ type: "plan", iteration: 2, sessionId: "s1", cli: "claude", model: "default", startedAt: "2026-03-19T00:00:00.000Z", completedAt: "2026-03-19T00:00:00.000Z", exitCode: 0, taskCompleted: null, tokensUsed: 100 },
						],
					},
				},
			});

			await executePlan(defaultFlags, {}, "/project");

			const getPrompt = mockRunLoop.mock.calls[0][0].getPrompt;
			getPrompt(1);

			expect(mockLoadPrompt).toHaveBeenCalledWith(
				"PROMPT_PLAN",
				expect.objectContaining({ ITERATION: "3", SPEC_NAME: "01-auth" }),
				{ cwd: "/project" },
			);
		});

		it("normal mode when status is not planned", async () => {
			mockReadStatus.mockReturnValue({ specs: {} });

			const onRefinement = vi.fn();
			await executePlan(defaultFlags, { onRefinement }, "/project");

			expect(onRefinement).not.toHaveBeenCalled();

			const getPrompt = mockRunLoop.mock.calls[0][0].getPrompt;
			getPrompt(1);

			expect(mockLoadPrompt).toHaveBeenCalledWith(
				"PROMPT_PLAN",
				expect.objectContaining({ ITERATION: "1", SPEC_NAME: "01-auth" }),
				{ cwd: "/project" },
			);
		});
	});

	describe("transcript", () => {
		it("executePlan with transcript:true creates transcript writer", async () => {
			const mockWriter = {
				writeEvent: vi.fn(),
				writeIterationHeader: vi.fn(),
				writeSpecHeader: vi.fn(),
				close: vi.fn(),
				filePath: "/tmp/.toby/transcripts/test.md",
			};
			mockOpenTranscript.mockReturnValue(mockWriter);

			await executePlan({ ...defaultFlags, transcript: true }, {}, "/project");

			expect(mockOpenTranscript).toHaveBeenCalledWith(
				expect.objectContaining({ command: "plan", specName: "01-auth" }),
			);
			expect(mockWriter.writeIterationHeader).toHaveBeenCalled();
			expect(mockWriter.close).toHaveBeenCalled();
		});

		it("executePlan with transcript:false creates no transcript writer", async () => {
			await executePlan({ ...defaultFlags, transcript: false }, {}, "/project");
			expect(mockOpenTranscript).not.toHaveBeenCalled();
		});

		it("--transcript flag overrides config false", async () => {
			const mockWriter = {
				writeEvent: vi.fn(),
				writeIterationHeader: vi.fn(),
				writeSpecHeader: vi.fn(),
				close: vi.fn(),
				filePath: "/tmp/.toby/transcripts/test.md",
			};
			mockOpenTranscript.mockReturnValue(mockWriter);

			// config.transcript is false (default), but flag is true
			await executePlan({ ...defaultFlags, transcript: true }, {}, "/project");
			expect(mockOpenTranscript).toHaveBeenCalled();
		});

		it("--no-transcript flag overrides config true", async () => {
			mockLoadConfig.mockReturnValue({
				plan: { cli: "claude", model: "default", iterations: 2 },
				build: { cli: "claude", model: "default", iterations: 10 },
				specsDir: "specs",
				excludeSpecs: ["README.md"],
				verbose: false,
				transcript: true,
				templateVars: {},
			});

			await executePlan({ ...defaultFlags, transcript: false }, {}, "/project");
			expect(mockOpenTranscript).not.toHaveBeenCalled();
		});

		it("transcript file contains iteration headers and text events", async () => {
			const mockWriter = {
				writeEvent: vi.fn(),
				writeIterationHeader: vi.fn(),
				writeSpecHeader: vi.fn(),
				close: vi.fn(),
				filePath: "/tmp/.toby/transcripts/test.md",
			};
			mockOpenTranscript.mockReturnValue(mockWriter);

			mockRunLoop.mockImplementation(async (options: LoopOptions) => {
				options.onEvent?.({ type: "text", timestamp: 1, content: "hello" } as never);
				const iterResult = {
					iteration: 1, sessionId: "sess-1", exitCode: 0, tokensUsed: 150,
					model: "claude-sonnet-4-6", durationMs: 1000, sentinelDetected: false,
				};
				options.onIterationComplete?.(iterResult);
				return { iterations: [iterResult], stopReason: "max_iterations" as const };
			});

			await executePlan({ ...defaultFlags, transcript: true }, {}, "/project");

			expect(mockWriter.writeEvent).toHaveBeenCalledWith(
				expect.objectContaining({ type: "text", content: "hello" }),
			);
			expect(mockWriter.writeIterationHeader).toHaveBeenCalledWith(
				expect.objectContaining({ iteration: 1, total: 2, cli: "claude" }),
			);
		});

		it("abort mid-session still calls close() via finally", async () => {
			const mockWriter = {
				writeEvent: vi.fn(),
				writeIterationHeader: vi.fn(),
				writeSpecHeader: vi.fn(),
				close: vi.fn(),
				filePath: "/tmp/.toby/transcripts/test.md",
			};
			mockOpenTranscript.mockReturnValue(mockWriter);

			mockRunLoop.mockImplementation(async (options: LoopOptions) => {
				const iterResult = {
					iteration: 1, sessionId: "sess-1", exitCode: 0, tokensUsed: 150,
					model: "claude-sonnet-4-6", durationMs: 1000, sentinelDetected: false,
				};
				options.onIterationComplete?.(iterResult);
				return { iterations: [iterResult], stopReason: "aborted" as const };
			});

			await expect(
				executePlan({ ...defaultFlags, transcript: true }, {}, "/project"),
			).rejects.toThrow(AbortError);

			expect(mockWriter.close).toHaveBeenCalled();
		});
	});

	describe("verbose mode", () => {
		it("passes all events to onEvent callback regardless of verbose flag", async () => {
			const events: Array<{ type: string; content?: string }> = [];

			mockRunLoop.mockImplementation(async (options: LoopOptions) => {
				options.onEvent?.({ type: "text", timestamp: 1, content: "hello" } as never);
				options.onEvent?.({ type: "tool_use", timestamp: 2, tool: { name: "Read" } } as never);
				options.onEvent?.({ type: "text", timestamp: 3, content: "world" } as never);

				const iterResult = {
					iteration: 1,
					sessionId: "sess-1",
					exitCode: 0,
					tokensUsed: 150,
					model: "claude-sonnet-4-6",
					durationMs: 1000,
					sentinelDetected: false,
				};
				options.onIterationComplete?.(iterResult);
				return { iterations: [iterResult], stopReason: "max_iterations" as const };
			});

			await executePlan(defaultFlags, {
				onEvent: (event) => { events.push({ type: event.type, content: event.content }); },
			}, "/project");

			expect(events).toHaveLength(3);
			expect(events[0]).toEqual({ type: "text", content: "hello" });
			expect(events[1]).toEqual({ type: "tool_use", content: undefined });
			expect(events[2]).toEqual({ type: "text", content: "world" });
		});

		it("verbose flag is part of PlanFlags interface", () => {
			const verboseFlags: PlanFlags = { ...defaultFlags, verbose: true };
			expect(verboseFlags.verbose).toBe(true);
		});
	});
});

describe("executePlanAll", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		setupDefaults();
	});

	it("processes pending specs in NN- order", async () => {
		const spec1 = makeSpec("01-auth", 1, "pending");
		const spec2 = makeSpec("02-api", 2, "pending");
		mockDiscoverSpecs.mockReturnValue([spec1, spec2]);
		mockFindSpec.mockImplementation((specs, query) => specs.find((s) => s.name === query));

		const onSpecStart = vi.fn();
		const result = await executePlanAll(
			{ all: true, verbose: false },
			{ onSpecStart },
			"/project",
		);

		expect(result.planned).toHaveLength(2);
		expect(result.planned[0].specName).toBe("01-auth");
		expect(result.planned[1].specName).toBe("02-api");
		expect(onSpecStart).toHaveBeenCalledTimes(2);
		expect(onSpecStart).toHaveBeenCalledWith("01-auth", 0, 2);
		expect(onSpecStart).toHaveBeenCalledWith("02-api", 1, 2);
	});

	it("returns stopReason per spec including max_iterations", async () => {
		const spec1 = makeSpec("01-auth", 1, "pending");
		const spec2 = makeSpec("02-api", 2, "pending");
		mockDiscoverSpecs.mockReturnValue([spec1, spec2]);
		mockFindSpec.mockImplementation((specs, query) => specs.find((s) => s.name === query));

		let callCount = 0;
		mockRunLoop.mockImplementation(async (options: LoopOptions) => {
			callCount++;
			const iterResult = {
				iteration: 1, sessionId: "sess-1", exitCode: 0, tokensUsed: 150,
				model: "claude-sonnet-4-6", durationMs: 1000,
				sentinelDetected: callCount === 1,
			};
			options.onIterationComplete?.(iterResult);
			return {
				iterations: [iterResult],
				stopReason: callCount === 1 ? "sentinel" as const : "max_iterations" as const,
			};
		});

		const result = await executePlanAll(
			{ all: true, verbose: false },
			{},
			"/project",
		);

		expect(result.planned).toHaveLength(2);
		expect(result.planned[0].stopReason).toBe("sentinel");
		expect(result.planned[1].stopReason).toBe("max_iterations");
		expect(result.planned[1].totalIterations).toBe(1);
		expect(result.planned[1].maxIterations).toBe(2);
	});

	it("only plans pending specs", async () => {
		const spec1 = makeSpec("01-auth", 1, "planned");
		const spec2 = makeSpec("02-api", 2, "pending");
		mockDiscoverSpecs.mockReturnValue([spec1, spec2]);
		mockFindSpec.mockImplementation((specs, query) => specs.find((s) => s.name === query));

		const result = await executePlanAll(
			{ all: true, verbose: false },
			{},
			"/project",
		);

		expect(result.planned).toHaveLength(1);
		expect(result.planned[0].specName).toBe("02-api");
	});

	it("stops on first failure", async () => {
		const spec1 = makeSpec("01-auth", 1, "pending");
		const spec2 = makeSpec("02-api", 2, "pending");
		mockDiscoverSpecs.mockReturnValue([spec1, spec2]);
		mockFindSpec.mockImplementation((specs, query) => {
			const found = specs.find((s) => s.name === query);
			if (query === "01-auth") return found;
			return undefined; // Simulate not-found for second spec
		});

		await expect(
			executePlanAll({ all: true, verbose: false }, {}, "/project"),
		).rejects.toThrow("Spec '02-api' not found");

		// Only first spec should have been attempted via runLoop
		expect(mockRunLoop).toHaveBeenCalledTimes(1);
	});

	it("returns empty planned array when all specs are already planned", async () => {
		const spec1 = makeSpec("01-auth", 1, "planned");
		const spec2 = makeSpec("02-api", 2, "done");
		mockDiscoverSpecs.mockReturnValue([spec1, spec2]);

		const result = await executePlanAll(
			{ all: true, verbose: false },
			{},
			"/project",
		);

		expect(result.planned).toHaveLength(0);
		expect(mockRunLoop).not.toHaveBeenCalled();
	});

	it("throws when no specs found", async () => {
		mockDiscoverSpecs.mockReturnValue([]);

		await expect(
			executePlanAll({ all: true, verbose: false }, {}, "/project"),
		).rejects.toThrow("No specs found in specs/");
	});
});

describe("executePlanAll transcript", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		setupDefaults();
	});

	it("executePlanAll with transcript:true creates one writer with spec headers", async () => {
		const mockWriter = {
			writeEvent: vi.fn(),
			writeIterationHeader: vi.fn(),
			writeSpecHeader: vi.fn(),
			close: vi.fn(),
			filePath: "/tmp/.toby/transcripts/all-plan-20260324.md",
		};
		mockOpenTranscript.mockReturnValue(mockWriter);

		const spec1 = makeSpec("01-auth", 1, "pending");
		const spec2 = makeSpec("02-api", 2, "pending");
		mockDiscoverSpecs.mockReturnValue([spec1, spec2]);
		mockFindSpec.mockImplementation((specs, query) => specs.find((s) => s.name === query));

		await executePlanAll(
			{ all: true, verbose: false, transcript: true },
			{},
			"/project",
		);

		// One writer opened for all specs
		expect(mockOpenTranscript).toHaveBeenCalledTimes(1);
		expect(mockOpenTranscript).toHaveBeenCalledWith(
			expect.objectContaining({ command: "plan" }),
		);

		// Spec headers written for each spec
		expect(mockWriter.writeSpecHeader).toHaveBeenCalledTimes(2);
		expect(mockWriter.writeSpecHeader).toHaveBeenCalledWith(1, 2, "01-auth");
		expect(mockWriter.writeSpecHeader).toHaveBeenCalledWith(2, 2, "02-api");

		// Close called once at the end
		expect(mockWriter.close).toHaveBeenCalledTimes(1);
	});

	it("executePlan with external writer does not close it", async () => {
		const mockWriter = {
			writeEvent: vi.fn(),
			writeIterationHeader: vi.fn(),
			writeSpecHeader: vi.fn(),
			close: vi.fn(),
			filePath: "/tmp/.toby/transcripts/test.md",
		};

		await executePlan(defaultFlags, {}, "/project", undefined, mockWriter);

		// Writer used for events/headers
		expect(mockWriter.writeIterationHeader).toHaveBeenCalled();
		// But NOT closed (caller's responsibility)
		expect(mockWriter.close).not.toHaveBeenCalled();
		// And openTranscript NOT called (external writer provided)
		expect(mockOpenTranscript).not.toHaveBeenCalled();
	});
});

describe("error handling edge cases", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		setupDefaults();
	});

	it("returns simplified PlanResult with only specName", async () => {
		const result = await executePlan(defaultFlags, {}, "/project");

		expect(result.specName).toBe("01-auth");
		expect(result).not.toHaveProperty("taskCount");
		expect(result).not.toHaveProperty("prdPath");
		expect(mockUpdateSpecStatus).toHaveBeenCalledWith(
			expect.anything(),
			"01-auth",
			"planned",
		);
	});

	it("throws AbortError when abortSignal is triggered", async () => {
		const controller = new AbortController();

		mockRunLoop.mockImplementation(async (options: LoopOptions) => {
			const iterResult = {
				iteration: 1,
				sessionId: "sess-1",
				exitCode: 0,
				tokensUsed: 150,
				model: "claude-sonnet-4-6",
				durationMs: 1000,
				sentinelDetected: false,
			};
			options.onIterationComplete?.(iterResult);
			return {
				iterations: [iterResult],
				stopReason: "aborted" as const,
			};
		});

		await expect(
			executePlan(defaultFlags, {}, "/project", controller.signal),
		).rejects.toThrow(AbortError);
	});

	it("saves partial status before throwing AbortError", async () => {
		const controller = new AbortController();

		mockRunLoop.mockImplementation(async (options: LoopOptions) => {
			const iterResult = {
				iteration: 1,
				sessionId: "sess-1",
				exitCode: 0,
				tokensUsed: 150,
				model: "claude-sonnet-4-6",
				durationMs: 1000,
				sentinelDetected: false,
			};
			options.onIterationComplete?.(iterResult);
			return {
				iterations: [iterResult],
				stopReason: "aborted" as const,
			};
		});

		try {
			await executePlan(defaultFlags, {}, "/project", controller.signal);
		} catch (err) {
			expect(err).toBeInstanceOf(AbortError);
			const abortErr = err as AbortError;
			expect(abortErr.specName).toBe("01-auth");
			expect(abortErr.completedIterations).toBe(1);
		}

		// Status should be saved: onIterationComplete writes + abort writes
		expect(mockWriteStatus).toHaveBeenCalled();
		expect(mockUpdateSpecStatus).toHaveBeenCalledWith(
			expect.anything(),
			"01-auth",
			"planned",
		);
	});

	it("passes abortSignal to runLoop", async () => {
		const controller = new AbortController();

		await executePlan(defaultFlags, {}, "/project", controller.signal);

		expect(mockRunLoop).toHaveBeenCalledWith(
			expect.objectContaining({ abortSignal: controller.signal }),
		);
	});

	it("executePlanAll forwards abortSignal to executePlan", async () => {
		const controller = new AbortController();

		mockRunLoop.mockImplementation(async (options: LoopOptions) => {
			// Verify signal was passed through
			expect(options.abortSignal).toBe(controller.signal);
			const iterResult = {
				iteration: 1,
				sessionId: "sess-1",
				exitCode: 0,
				tokensUsed: 150,
				model: "claude-sonnet-4-6",
				durationMs: 1000,
				sentinelDetected: false,
			};
			options.onIterationComplete?.(iterResult);
			return {
				iterations: [iterResult],
				stopReason: "max_iterations" as const,
			};
		});

		const spec1 = makeSpec("01-auth", 1, "pending");
		mockDiscoverSpecs.mockReturnValue([spec1]);
		mockFindSpec.mockReturnValue(spec1);
		await executePlanAll(
			{ all: true, verbose: false },
			{},
			"/project",
			controller.signal,
		);

		expect(mockRunLoop).toHaveBeenCalledWith(
			expect.objectContaining({ abortSignal: controller.signal }),
		);
	});
});

describe("Plan component", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		setupDefaults();
	});

	it("renders spec selector when no --spec flag provided", async () => {
		const specs = [
			makeSpec("01-auth", 1, "pending"),
			makeSpec("02-api", 2, "pending"),
		];
		mockDiscoverSpecs.mockReturnValue(specs);

		const { lastFrame } = render(
			<Plan all={false} verbose={false} />,
		);

		// Wait for useEffect to discover specs and re-render with MultiSpecSelector
		await vi.waitFor(() => {
			const output = lastFrame()!;
			expect(output).toContain("Select specs to plan");
			expect(output).toContain("01-auth");
			expect(output).toContain("02-api");
		});
	});

	it("skips selector and starts planning with --spec flag", async () => {
		// With --spec provided, phase starts at "init" and executePlan runs immediately
		// The component should NOT show the selector
		mockRunLoop.mockImplementation(async (options: LoopOptions) => {
			const iterResult = {
				iteration: 1,
				sessionId: "sess-1",
				exitCode: 0,
				tokensUsed: 150,
				model: "claude-sonnet-4-6",
				durationMs: 1000,
				sentinelDetected: false,
			};
			options.onIterationComplete?.(iterResult);
			return { iterations: [iterResult], stopReason: "max_iterations" as const };
		});
		const { lastFrame } = render(
			<Plan spec="auth" all={false} verbose={false} />,
		);

		// Should NOT show selector
		const output = lastFrame()!;
		expect(output).not.toContain("Select specs to plan");
	});

	it("only shows pending specs in selector", async () => {
		const specs = [
			{ name: "01-auth", path: "/p/specs/01-auth.md", order: { num: 1, suffix: null }, status: "pending" as const },
			{ name: "02-api", path: "/p/specs/02-api.md", order: { num: 2, suffix: null }, status: "planned" as const },
			{ name: "03-ui", path: "/p/specs/03-ui.md", order: { num: 3, suffix: null }, status: "building" as const },
			{ name: "04-done", path: "/p/specs/04-done.md", order: { num: 4, suffix: null }, status: "done" as const },
		];
		mockDiscoverSpecs.mockReturnValue(specs);

		const { lastFrame } = render(
			<Plan all={false} verbose={false} />,
		);

		await vi.waitFor(() => {
			const output = lastFrame()!;
			expect(output).toContain("01-auth");
			expect(output).not.toContain("02-api");
			expect(output).not.toContain("03-ui");
			expect(output).not.toContain("04-done");
		});
	});

	it("shows error when no pending specs exist", async () => {
		const specs = [
			{ name: "01-auth", path: "/p/specs/01-auth.md", order: { num: 1, suffix: null }, status: "planned" as const },
			{ name: "02-api", path: "/p/specs/02-api.md", order: { num: 2, suffix: null }, status: "done" as const },
		];
		mockDiscoverSpecs.mockReturnValue(specs);

		const { lastFrame } = render(
			<Plan all={false} verbose={false} />,
		);

		await vi.waitFor(() => {
			const output = lastFrame()!;
			expect(output).toContain("No pending specs to plan");
		});
	});

	it("shows error when spec not found", async () => {
		mockFindSpec.mockReturnValue(undefined);

		const { lastFrame } = render(
			<Plan spec="nonexistent" all={false} verbose={false} />,
		);

		// Wait for async effect to resolve
		await vi.waitFor(() => {
			const output = lastFrame()!;
			expect(output).toContain("not found");
		});
	});

	it("max_iterations shows warning instead of success", async () => {
		mockRunLoop.mockImplementation(async (options: LoopOptions) => {
			const iterResult = {
				iteration: 1, sessionId: "sess-1", exitCode: 0, tokensUsed: 150,
				model: "claude-sonnet-4-6", durationMs: 1000, sentinelDetected: false,
			};
			options.onIterationComplete?.(iterResult);
			return { iterations: [iterResult], stopReason: "max_iterations" as const };
		});

		const { lastFrame } = render(
			<Plan spec="auth" all={false} verbose={false} />,
		);

		await vi.waitFor(() => {
			const output = lastFrame()!;
			expect(output).toContain("⚠️");
			expect(output).toContain("maximum plan iteration limit reached");
			expect(output).toContain("1/2");
			expect(output).not.toContain("✓");
		});
	});
});

describe("integration: full plan flow with mocked spawner", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		setupDefaults();
	});

	it("completes full plan lifecycle: discover → load → plan → update status → return result", async () => {
		const spec = makeSpec("01-auth", 1, "pending");
		mockDiscoverSpecs.mockReturnValue([spec]);
		mockFindSpec.mockReturnValue(spec);
		mockReadStatus.mockReturnValue({ specs: {} });

		const updatedStatus = { specs: { "01-auth": { status: "planned", plannedAt: null, iterations: [] } } };
		mockAddIteration.mockReturnValue(updatedStatus);
		mockUpdateSpecStatus.mockReturnValue(updatedStatus);

		// Simulate spawner running 2 iterations
		let iterationCount = 0;
		mockRunLoop.mockImplementation(async (options: LoopOptions) => {
			const iterations = [];
			for (let i = 1; i <= 2; i++) {
				iterationCount++;
				const iterResult = {
					iteration: i,
					sessionId: `sess-${i}`,
					exitCode: 0,
					tokensUsed: 100 + i * 50,
					model: "claude-sonnet-4-6",
					durationMs: 1000 * i,
					sentinelDetected: false,
				};
				options.onIterationComplete?.(iterResult);
				iterations.push(iterResult);
			}
			return { iterations, stopReason: "max_iterations" as const };
		});

		const callbacks = {
			onPhase: vi.fn(),
			onIteration: vi.fn(),
			onEvent: vi.fn(),
		};

		const result = await executePlan(
			{ spec: "auth", all: false, verbose: false },
			callbacks,
			"/project",
		);

		// Verify full lifecycle
		expect(mockLoadConfig).toHaveBeenCalledWith("/project");
		expect(mockDiscoverSpecs).toHaveBeenCalledWith("/project", expect.anything());
		expect(mockFindSpec).toHaveBeenCalledWith(expect.anything(), "auth");
		expect(mockRunLoop).toHaveBeenCalledOnce();
		expect(iterationCount).toBe(2);
		expect(mockAddIteration).toHaveBeenCalledTimes(2);
		expect(mockUpdateSpecStatus).toHaveBeenCalledWith(expect.anything(), "01-auth", "planned");
		expect(mockWriteStatus).toHaveBeenCalledTimes(3); // 2 iterations + 1 final

		// Verify result — PlanResult with iteration metadata
		expect(result.specName).toBe("01-auth");
		expect(result.totalIterations).toBe(2);
		expect(result.maxIterations).toBe(2);
		expect(result.stopReason).toBe("max_iterations");
		expect(result).not.toHaveProperty("taskCount");
		expect(result).not.toHaveProperty("prdPath");

		// Verify callbacks fired
		expect(callbacks.onPhase).toHaveBeenCalledWith("planning");
		expect(callbacks.onIteration).toHaveBeenCalledTimes(3); // initial + 2 iteration completions
	});
});
