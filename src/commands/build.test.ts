import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { CliEvent } from "@0xtiby/spawner";

vi.mock("../lib/config.js", () => ({
	loadConfig: vi.fn(),
	resolveCommandConfig: vi.fn(),
}));

vi.mock("../lib/specs.js", () => ({
	discoverSpecs: vi.fn(),
	filterByStatus: vi.fn(),
	findSpec: vi.fn(),
	findSpecs: vi.fn(),
	loadSpecContent: vi.fn(),
	sortSpecs: vi.fn(),
}));

vi.mock("../ui/stream.js", () => ({
	writeEvent: vi.fn(),
}));

vi.mock("../ui/tty.js", () => ({
	isTTY: vi.fn(() => true),
}));

vi.mock("../ui/prompt.js", () => ({
	selectSpecs: vi.fn(),
}));

vi.mock("../lib/template.js", () => ({
	loadPrompt: vi.fn(),
	computeCliVars: vi.fn((opts: Record<string, unknown>) => ({
		SPEC_NAME: opts.specName,
		SPEC_SLUG: String(opts.specName).replace(/^\d+-/, ""),
		ITERATION: String(opts.iteration),
		SPEC_INDEX: String(opts.specIndex),
		SPEC_COUNT: String(opts.specCount),
		SESSION: opts.session,
		SPECS: (opts.specs as string[]).join(", "),
		SPECS_DIR: opts.specsDir,
	})),
	resolveTemplateVars: vi.fn((cliVars: Record<string, string>, _configVars: Record<string, string>) => ({ ...cliVars })),
	computeSpecSlug: vi.fn((name: string) => name.replace(/^\d+-/, "")),
	generateSessionName: vi.fn(() => "bold-hawk-42"),
}));

vi.mock("../lib/loop.js", () => ({
	runLoop: vi.fn(),
}));

vi.mock("../lib/status.js", () => ({
	readStatus: vi.fn(),
	writeStatus: vi.fn(),
	addIteration: vi.fn(),
	updateSpecStatus: vi.fn(),
	createSession: vi.fn((name: string, cli: string, specs: string[]) => ({
		name, cli, specs, state: "active", startedAt: "2026-03-20T00:00:00.000Z",
	})),
	clearSession: vi.fn((status: Record<string, unknown>) => {
		const { session: _, ...rest } = status;
		return rest;
	}),
	updateSessionState: vi.fn((status: Record<string, unknown>, state: string) => {
		if (!status.session) return status;
		return { ...status, session: { ...(status.session as Record<string, unknown>), state } };
	}),
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
import { discoverSpecs, filterByStatus, findSpec, findSpecs, loadSpecContent, sortSpecs } from "../lib/specs.js";
import { loadPrompt, computeCliVars, resolveTemplateVars, computeSpecSlug, generateSessionName } from "../lib/template.js";
import { runLoop } from "../lib/loop.js";
import type { LoopOptions } from "../lib/loop.js";
import { readStatus, writeStatus, addIteration, updateSpecStatus, createSession, clearSession, updateSessionState } from "../lib/status.js";
import { openTranscript } from "../lib/transcript.js";
import { executeBuild, executeBuildAll, runBuild } from "./build.js";
import { AbortError } from "../lib/errors.js";
import type { BuildFlags } from "./build.js";
import { writeEvent } from "../ui/stream.js";
import { isTTY } from "../ui/tty.js";
import { selectSpecs } from "../ui/prompt.js";

const mockLoadConfig = vi.mocked(loadConfig);
const mockResolveCommandConfig = vi.mocked(resolveCommandConfig);
const mockDiscoverSpecs = vi.mocked(discoverSpecs);
const mockFilterByStatus = vi.mocked(filterByStatus);
const mockSortSpecs = vi.mocked(sortSpecs);
const mockFindSpec = vi.mocked(findSpec);
const mockLoadSpecContent = vi.mocked(loadSpecContent);
const mockLoadPrompt = vi.mocked(loadPrompt);
const mockComputeCliVars = vi.mocked(computeCliVars);
const mockResolveTemplateVars = vi.mocked(resolveTemplateVars);
const mockComputeSpecSlug = vi.mocked(computeSpecSlug);
const mockGenerateSessionName = vi.mocked(generateSessionName);
const mockRunLoop = vi.mocked(runLoop);
const mockReadStatus = vi.mocked(readStatus);
const mockWriteStatus = vi.mocked(writeStatus);
const mockAddIteration = vi.mocked(addIteration);
const mockUpdateSpecStatus = vi.mocked(updateSpecStatus);
const mockCreateSession = vi.mocked(createSession);
const mockClearSession = vi.mocked(clearSession);
const mockUpdateSessionState = vi.mocked(updateSessionState);
const mockOpenTranscript = vi.mocked(openTranscript);
const defaultFlags: BuildFlags = {
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
		iterations: 10,
	});

	const spec = {
		name: "01-auth",
		path: "/project/specs/01-auth.md",
		order: { num: 1, suffix: null },
		status: "planned" as const,
	};

	mockDiscoverSpecs.mockReturnValue([spec]);
	mockFilterByStatus.mockImplementation((specs, status) => specs.filter((s) => s.status === status));
	mockSortSpecs.mockImplementation((specs) => [...specs].sort((a, b) => (a.order?.num ?? 0) - (b.order?.num ?? 0)));
	mockFindSpec.mockReturnValue(spec);
	mockLoadSpecContent.mockReturnValue({ ...spec, content: "# Auth Spec\nContent here" });
	mockLoadPrompt.mockReturnValue("Build prompt for 01-auth");
	mockReadStatus.mockReturnValue({
		specs: {
			"01-auth": {
				status: "planned",
				plannedAt: "2026-03-20T00:00:00.000Z",
				iterations: [],
			},
		},
	});
	mockAddIteration.mockImplementation((status, specName, iteration) => ({
		...status,
		specs: {
			...status.specs,
			[specName]: {
				...(status.specs[specName] ?? { status: "pending", plannedAt: null, iterations: [] }),
				iterations: [...(status.specs[specName]?.iterations ?? []), iteration],
			},
		},
	}));
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
		options.onIterationStart?.(1, null);
		options.onIterationComplete?.(iterResult);
		return {
			iterations: [iterResult],
			stopReason: "max_iterations" as const,
		};
	});
}

describe("executeBuild", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		setupDefaults();
	});

	it("calls runLoop with correct config-derived options", async () => {
		await executeBuild(defaultFlags, {}, "/project");

		expect(mockRunLoop).toHaveBeenCalledOnce();
		const opts = mockRunLoop.mock.calls[0][0];
		expect(opts.maxIterations).toBe(10);
		expect(opts.cli).toBe("claude");
		expect(opts.cwd).toBe("/project");
		expect(opts.continueSession).toBe(true);
	});

	it("errors when spec has no plan in status.json", async () => {
		mockReadStatus.mockReturnValue({ specs: {} });

		await expect(
			executeBuild(defaultFlags, {}, "/project"),
		).rejects.toThrow("No plan found for 01-auth. Run 'toby plan --spec=auth' first.");

		expect(mockRunLoop).not.toHaveBeenCalled();
	});

	it("--iterations flag sets maxIterations on runLoop call", async () => {
		mockResolveCommandConfig.mockReturnValue({
			cli: "claude",
			model: "default",
			iterations: 5,
		});

		await executeBuild({ ...defaultFlags, iterations: 5 }, {}, "/project");

		expect(mockResolveCommandConfig).toHaveBeenCalledWith(
			expect.anything(),
			"build",
			expect.objectContaining({ iterations: 5 }),
		);
		expect(mockRunLoop.mock.calls[0][0].maxIterations).toBe(5);
	});

	it("--cli flag selects the correct AI CLI spawner", async () => {
		mockResolveCommandConfig.mockReturnValue({
			cli: "codex",
			model: "default",
			iterations: 10,
		});

		await executeBuild({ ...defaultFlags, cli: "codex" }, {}, "/project");

		expect(mockResolveCommandConfig).toHaveBeenCalledWith(
			expect.anything(),
			"build",
			expect.objectContaining({ cli: "codex" }),
		);
		expect(mockRunLoop.mock.calls[0][0].cli).toBe("codex");
	});

	it("prompt template uses PROMPT_BUILD with correct substitution variables", async () => {
		await executeBuild(defaultFlags, {}, "/project");

		const getPrompt = mockRunLoop.mock.calls[0][0].getPrompt;
		getPrompt(1);

		expect(mockLoadPrompt).toHaveBeenCalledWith(
			"PROMPT_BUILD",
			expect.objectContaining({
				SPEC_NAME: "01-auth",
				ITERATION: "1",
				SPEC_INDEX: "1",
				SPEC_COUNT: "1",
				SPECS: "01-auth",
				SPECS_DIR: "specs",
			}),
			{ cwd: "/project" },
		);
	});

	it("error shown when spec not found", async () => {
		mockFindSpec.mockReturnValue(undefined);

		await expect(
			executeBuild({ ...defaultFlags, spec: "nonexistent" }, {}, "/project"),
		).rejects.toThrow("Spec 'nonexistent' not found");

		expect(mockRunLoop).not.toHaveBeenCalled();
	});

	it("error shown when no specs found", async () => {
		mockDiscoverSpecs.mockReturnValue([]);

		await expect(
			executeBuild(defaultFlags, {}, "/project"),
		).rejects.toThrow("No specs found in specs/");

		expect(mockRunLoop).not.toHaveBeenCalled();
	});

	it("error shown when no --spec flag provided", async () => {
		await expect(
			executeBuild({ ...defaultFlags, spec: undefined }, {}, "/project"),
		).rejects.toThrow("No --spec flag provided");
	});

	it("allows build on spec with building status", async () => {
		mockReadStatus.mockReturnValue({
			specs: {
				"01-auth": {
					status: "building",
					plannedAt: null,
					iterations: [
						{ type: "build", iteration: 1, sessionId: "s1", state: "complete", cli: "claude", model: "default", startedAt: "2026-03-19T00:00:00.000Z", completedAt: "2026-03-19T00:00:00.000Z", exitCode: 0, taskCompleted: null, tokensUsed: 100 },
					],
				},
			},
		});

		const result = await executeBuild(defaultFlags, {}, "/project");

		expect(result.specName).toBe("01-auth");
		expect(mockRunLoop).toHaveBeenCalled();
	});

	it("returns error summary on fatal error during iteration", async () => {
		mockRunLoop.mockImplementation(async (options: LoopOptions) => {
			const iterResult = {
				iteration: 1, sessionId: "sess-1", exitCode: 1, tokensUsed: 50,
				model: "claude-sonnet-4-6", durationMs: 1000, sentinelDetected: false,
			};
			options.onIterationStart?.(iterResult.iteration, iterResult.sessionId);
			options.onIterationComplete?.(iterResult);
			return { iterations: [iterResult], stopReason: "error" as const };
		});

		const result = await executeBuild(defaultFlags, {}, "/project");

		expect(result.specDone).toBe(false);
		expect(result.error).toContain("Build failed after 1 iteration(s)");
		expect(result.error).toContain("exit code: 1");
		expect(mockUpdateSpecStatus).toHaveBeenCalledWith(expect.anything(), "01-auth", "building");
	});

	it("status is updated after each iteration completes", async () => {
		await executeBuild(defaultFlags, {}, "/project");

		expect(mockAddIteration).toHaveBeenCalledWith(
			expect.anything(),
			"01-auth",
			expect.objectContaining({
				type: "build",
				iteration: 1,
				state: "in_progress",
				cli: "claude",
			}),
		);
		expect(mockWriteStatus).toHaveBeenCalledTimes(5); // 1 session create + 1 onIterationStart + 1 onIterationComplete + 1 final spec status + 1 session interrupted
	});

	it("spec status transitions to building on completion", async () => {
		await executeBuild(defaultFlags, {}, "/project");

		expect(mockUpdateSpecStatus).toHaveBeenCalledWith(
			expect.anything(),
			"01-auth",
			"building",
		);
	});

	it("iteration numbering continues from existing iterations", async () => {
		mockReadStatus.mockReturnValue({
			specs: {
				"01-auth": {
					status: "building",
					plannedAt: null,
					iterations: [
						{ type: "build", iteration: 1, sessionId: "s1", state: "complete", cli: "claude", model: "default", startedAt: "2026-03-19T00:00:00.000Z", completedAt: "2026-03-19T00:00:00.000Z", exitCode: 0, taskCompleted: null, tokensUsed: 100 },
						{ type: "build", iteration: 2, sessionId: "s1", state: "complete", cli: "claude", model: "default", startedAt: "2026-03-19T00:00:00.000Z", completedAt: "2026-03-19T00:00:00.000Z", exitCode: 0, taskCompleted: null, tokensUsed: 100 },
					],
				},
			},
		});

		await executeBuild(defaultFlags, {}, "/project");

		const getPrompt = mockRunLoop.mock.calls[0][0].getPrompt;
		getPrompt(1);

		expect(mockLoadPrompt).toHaveBeenCalledWith(
			"PROMPT_BUILD",
			expect.objectContaining({ ITERATION: "3", SPEC_NAME: "01-auth" }),
			{ cwd: "/project" },
		);
	});

	it("marks spec as done when sentinel detected", async () => {
		mockRunLoop.mockImplementation(async (options: LoopOptions) => {
			const iterResult = {
				iteration: 1, sessionId: "sess-1", exitCode: 0, tokensUsed: 150,
				model: "claude-sonnet-4-6", durationMs: 1000, sentinelDetected: true,
			};
			options.onIterationStart?.(iterResult.iteration, iterResult.sessionId);
			options.onIterationComplete?.(iterResult);
			return { iterations: [iterResult], stopReason: "sentinel" as const };
		});

		const result = await executeBuild(defaultFlags, {}, "/project");

		expect(mockUpdateSpecStatus).toHaveBeenCalledWith(
			expect.anything(),
			"01-auth",
			"done",
		);
		expect(result.specDone).toBe(true);
	});

	it("result includes totalIterations and totalTokens", async () => {
		mockRunLoop.mockImplementation(async (options: LoopOptions) => {
			const iterations = [];
			for (let i = 1; i <= 3; i++) {
				const iterResult = {
					iteration: i, sessionId: `sess-${i}`, exitCode: 0, tokensUsed: 100 * i,
					model: "claude-sonnet-4-6", durationMs: 1000, sentinelDetected: false,
				};
				options.onIterationStart?.(iterResult.iteration, iterResult.sessionId);
				options.onIterationComplete?.(iterResult);
				iterations.push(iterResult);
			}
			return { iterations, stopReason: "max_iterations" as const };
		});

		const result = await executeBuild(defaultFlags, {}, "/project");

		expect(result.totalIterations).toBe(3);
		expect(result.totalTokens).toBe(600); // 100 + 200 + 300
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
			options.onIterationStart?.(iterResult.iteration, iterResult.sessionId);
			options.onIterationComplete?.(iterResult);
			return {
				iterations: [iterResult],
				stopReason: "aborted" as const,
			};
		});

		await expect(
			executeBuild(defaultFlags, {}, "/project", controller.signal),
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
			options.onIterationStart?.(iterResult.iteration, iterResult.sessionId);
			options.onIterationComplete?.(iterResult);
			return {
				iterations: [iterResult],
				stopReason: "aborted" as const,
			};
		});

		try {
			await executeBuild(defaultFlags, {}, "/project", controller.signal);
		} catch (err) {
			expect(err).toBeInstanceOf(AbortError);
			const abortErr = err as AbortError;
			expect(abortErr.specName).toBe("01-auth");
			expect(abortErr.completedIterations).toBe(1);
		}

		expect(mockWriteStatus).toHaveBeenCalled();
		expect(mockUpdateSpecStatus).toHaveBeenCalledWith(
			expect.anything(),
			"01-auth",
			"building",
		);
	});

	it("passes abortSignal to runLoop", async () => {
		const controller = new AbortController();

		await executeBuild(defaultFlags, {}, "/project", controller.signal);

		expect(mockRunLoop).toHaveBeenCalledWith(
			expect.objectContaining({ abortSignal: controller.signal }),
		);
	});
});

const mockWriteEvent = vi.mocked(writeEvent);
const mockIsTTY = vi.mocked(isTTY);
const mockSelectSpecs = vi.mocked(selectSpecs);
const mockFindSpecs = vi.mocked(findSpecs);

function makeSpec(name: string, num: number, status: "pending" | "planned" | "building" | "done") {
	return { name, path: `/project/specs/${name}.md`, order: { num, suffix: null }, status };
}

describe("runBuild", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		setupDefaults();
		vi.spyOn(console, "log").mockImplementation(() => {});
		vi.spyOn(console, "error").mockImplementation(() => {});
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("--all mode builds planned specs and prints summary", async () => {
		const spec1 = makeSpec("01-auth", 1, "planned");
		mockDiscoverSpecs.mockReturnValue([spec1]);
		mockFilterByStatus.mockReturnValue([spec1]);
		mockSortSpecs.mockReturnValue([spec1]);
		mockFindSpec.mockReturnValue(spec1);

		await runBuild({ all: true, verbose: false });

		expect(mockRunLoop).toHaveBeenCalledTimes(1);
		expect(console.log).toHaveBeenCalledWith(
			expect.stringContaining("All specs built"),
		);
	});

	it("--all mode with no specs prints friendly message", async () => {
		mockDiscoverSpecs.mockReturnValue([]);

		await runBuild({ all: true, verbose: false });

		expect(console.log).toHaveBeenCalledWith("No specs found.");
		expect(mockRunLoop).not.toHaveBeenCalled();
	});

	it("--all mode with no planned specs prints friendly message", async () => {
		const spec1 = makeSpec("01-auth", 1, "pending");
		mockDiscoverSpecs.mockReturnValue([spec1]);
		mockFilterByStatus.mockReturnValue([]);
		mockSortSpecs.mockReturnValue([]);

		await runBuild({ all: true, verbose: false });

		expect(console.log).toHaveBeenCalledWith("No planned specs found. Run 'toby plan' first.");
		expect(mockRunLoop).not.toHaveBeenCalled();
	});

	it("--all mode wires onEvent to writeEvent", async () => {
		const spec1 = makeSpec("01-auth", 1, "planned");
		mockDiscoverSpecs.mockReturnValue([spec1]);
		mockFilterByStatus.mockReturnValue([spec1]);
		mockSortSpecs.mockReturnValue([spec1]);
		mockFindSpec.mockReturnValue(spec1);

		const testEvent = { type: "text", timestamp: 1, content: "hello" } as never;
		mockRunLoop.mockImplementation(async (options) => {
			options.onEvent?.(testEvent);
			const iterResult = {
				iteration: 1, sessionId: "sess-1", exitCode: 0, tokensUsed: 150,
				model: "claude-sonnet-4-6", durationMs: 1000, sentinelDetected: false,
			};
			options.onIterationStart?.(iterResult.iteration, iterResult.sessionId);
			options.onIterationComplete?.(iterResult);
			return { iterations: [iterResult], stopReason: "max_iterations" as const };
		});

		await runBuild({ all: true, verbose: false });

		expect(mockWriteEvent).toHaveBeenCalledWith(testEvent, false);
	});

	it("--all mode handles SIGINT gracefully", async () => {
		const spec1 = makeSpec("01-auth", 1, "planned");
		mockDiscoverSpecs.mockReturnValue([spec1]);
		mockFilterByStatus.mockReturnValue([spec1]);
		mockSortSpecs.mockReturnValue([spec1]);
		mockFindSpec.mockReturnValue(spec1);

		mockRunLoop.mockImplementation(async (options) => {
			const iterResult = {
				iteration: 1, sessionId: "sess-1", exitCode: 0, tokensUsed: 150,
				model: "claude-sonnet-4-6", durationMs: 1000, sentinelDetected: false,
			};
			options.onIterationStart?.(iterResult.iteration, iterResult.sessionId);
			options.onIterationComplete?.(iterResult);
			return { iterations: [iterResult], stopReason: "aborted" as const };
		});

		await runBuild({ all: true, verbose: false });

		expect(console.log).toHaveBeenCalledWith(
			expect.stringContaining("Building interrupted"),
		);
	});

	it("--spec with single name calls executeBuild", async () => {
		const spec1 = makeSpec("01-auth", 1, "planned");
		mockDiscoverSpecs.mockReturnValue([spec1]);
		mockFindSpec.mockReturnValue(spec1);

		mockRunLoop.mockImplementation(async (options) => {
			const iterResult = {
				iteration: 1, sessionId: "sess-1", exitCode: 0, tokensUsed: 500,
				model: "claude-sonnet-4-6", durationMs: 1000, sentinelDetected: true,
			};
			options.onIterationStart?.(iterResult.iteration, iterResult.sessionId);
			options.onIterationComplete?.(iterResult);
			return { iterations: [iterResult], stopReason: "sentinel" as const };
		});

		await runBuild({ spec: "auth", verbose: false });

		expect(mockRunLoop).toHaveBeenCalledTimes(1);
		expect(console.log).toHaveBeenCalledWith(
			expect.stringContaining("Build complete"),
		);
	});

	it("--spec with unknown name prints error", async () => {
		mockDiscoverSpecs.mockReturnValue([makeSpec("01-auth", 1, "planned")]);
		mockFindSpec.mockReturnValue(undefined);

		await runBuild({ spec: "nonexistent", verbose: false });

		expect(console.error).toHaveBeenCalledWith(
			expect.stringContaining("not found"),
		);
	});

	it("--spec with pending spec prints plan-first error", async () => {
		const spec1 = makeSpec("01-auth", 1, "pending");
		mockDiscoverSpecs.mockReturnValue([spec1]);
		mockFindSpec.mockReturnValue(spec1);
		mockReadStatus.mockReturnValue({ specs: {} });

		await runBuild({ spec: "auth", verbose: false });

		expect(console.error).toHaveBeenCalledWith(
			expect.stringContaining("has not been planned yet"),
		);
	});

	it("--spec with done spec prints already-done error", async () => {
		const spec1 = makeSpec("01-auth", 1, "done");
		mockDiscoverSpecs.mockReturnValue([spec1]);
		mockFindSpec.mockReturnValue(spec1);
		mockReadStatus.mockReturnValue({
			specs: { "01-auth": { status: "done", plannedAt: null, iterations: [] } },
		});

		await runBuild({ spec: "auth", verbose: false });

		expect(console.error).toHaveBeenCalledWith(
			expect.stringContaining("already done"),
		);
	});

	it("non-TTY without flags prints error", async () => {
		mockIsTTY.mockReturnValue(false);

		await runBuild({ verbose: false });

		expect(console.error).toHaveBeenCalledWith(
			expect.stringContaining("--all or --spec"),
		);
	});

	it("TTY with no flags prompts multiselect", async () => {
		mockIsTTY.mockReturnValue(true);
		const spec1 = makeSpec("01-auth", 1, "planned");
		mockDiscoverSpecs.mockReturnValue([spec1]);
		mockFilterByStatus.mockReturnValue([spec1]);
		mockSortSpecs.mockReturnValue([spec1]);
		mockSelectSpecs.mockResolvedValue([spec1]);
		mockFindSpec.mockReturnValue(spec1);

		await runBuild({ verbose: false });

		expect(mockSelectSpecs).toHaveBeenCalled();
		expect(mockRunLoop).toHaveBeenCalled();
	});

	it("TTY multiselect with no selection prints friendly message", async () => {
		mockIsTTY.mockReturnValue(true);
		const spec1 = makeSpec("01-auth", 1, "planned");
		mockDiscoverSpecs.mockReturnValue([spec1]);
		mockFilterByStatus.mockReturnValue([spec1]);
		mockSortSpecs.mockReturnValue([spec1]);
		mockSelectSpecs.mockResolvedValue([]);

		await runBuild({ verbose: false });

		expect(console.log).toHaveBeenCalledWith("No specs selected.");
		expect(mockRunLoop).not.toHaveBeenCalled();
	});
});

describe("integration: full build flow with mocked spawner", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		setupDefaults();
	});

	it("sentinel detected after N iterations stops loop and marks spec done", async () => {
		mockRunLoop.mockImplementation(async (options: LoopOptions) => {
			const iterations = [];
			for (let i = 1; i <= 4; i++) {
				const iterResult = {
					iteration: i,
					sessionId: `sess-${i}`,
					exitCode: 0,
					tokensUsed: 200,
					model: "claude-sonnet-4-6",
					durationMs: 1000,
					sentinelDetected: i === 4,
				};
				options.onIterationStart?.(iterResult.iteration, iterResult.sessionId);
				options.onIterationComplete?.(iterResult);
				iterations.push(iterResult);
			}
			return { iterations, stopReason: "sentinel" as const };
		});

		const result = await executeBuild(defaultFlags, {}, "/project");

		expect(result.totalIterations).toBe(4);
		expect(result.totalTokens).toBe(800);
		expect(result.specDone).toBe(true);
		expect(mockUpdateSpecStatus).toHaveBeenCalledWith(expect.anything(), "01-auth", "done");
		expect(mockAddIteration).toHaveBeenCalledTimes(4);
		expect(mockWriteStatus).toHaveBeenCalledTimes(11); // 1 session create + 4 onIterationStart + 4 onIterationComplete + 1 final spec status + 1 session clear
	});

	it("build --all processes specs in order with correct session vars and collects results", async () => {
		const specs = [
			{ name: "02-api", path: "/p/specs/02-api.md", order: { num: 2, suffix: null }, status: "planned" as const },
			{ name: "01-auth", path: "/p/specs/01-auth.md", order: { num: 1, suffix: null }, status: "planned" as const },
			{ name: "03-ui", path: "/p/specs/03-ui.md", order: { num: 3, suffix: null }, status: "building" as const },
		];
		mockDiscoverSpecs.mockReturnValue(specs);

		const specOrder: string[] = [];
		const specIndices: Record<string, string> = {};

		mockRunLoop.mockImplementation(async (options: LoopOptions) => {
			options.getPrompt(1);
			const iterResult = {
				iteration: 1, sessionId: "sess-1", exitCode: 0, tokensUsed: 100,
				model: "claude-sonnet-4-6", durationMs: 500, sentinelDetected: true,
			};
			options.onIterationStart?.(iterResult.iteration, iterResult.sessionId);
			options.onIterationComplete?.(iterResult);
			return { iterations: [iterResult], stopReason: "sentinel" as const };
		});

		mockLoadPrompt.mockImplementation((_template, vars) => {
			specIndices[vars.SPEC_NAME] = vars.SPEC_INDEX;
			return `prompt for ${vars.SPEC_NAME}`;
		});

		const result = await executeBuildAll(
			{ all: true, verbose: false },
			{ onSpecStart: (name) => { specOrder.push(name); } },
			"/p",
		);

		// Sorted order: 01-auth, 02-api, 03-ui
		expect(specOrder).toEqual(["01-auth", "02-api", "03-ui"]);
		expect(specIndices["01-auth"]).toBe("1");
		expect(specIndices["02-api"]).toBe("2");
		expect(specIndices["03-ui"]).toBe("3");
		expect(result.built).toHaveLength(3);
		expect(result.built.map((r) => r.specName)).toEqual(["01-auth", "02-api", "03-ui"]);
	});

	it("error flow when spec not planned halts before loop", async () => {
		mockReadStatus.mockReturnValue({ specs: {} });

		await expect(
			executeBuild(defaultFlags, {}, "/project"),
		).rejects.toThrow("No plan found for 01-auth");

		expect(mockRunLoop).not.toHaveBeenCalled();
		expect(mockAddIteration).not.toHaveBeenCalled();
		expect(mockWriteStatus).not.toHaveBeenCalled();
	});

	it("max iterations reached returns remaining task count and does not mark spec done", async () => {
		mockRunLoop.mockImplementation(async (options: LoopOptions) => {
			const iterations = [];
			for (let i = 1; i <= 2; i++) {
				const iterResult = {
					iteration: i, sessionId: `sess-${i}`, exitCode: 0, tokensUsed: 150,
					model: "claude-sonnet-4-6", durationMs: 1000, sentinelDetected: false,
				};
				options.onIterationStart?.(iterResult.iteration, iterResult.sessionId);
				options.onIterationComplete?.(iterResult);
				iterations.push(iterResult);
			}
			return { iterations, stopReason: "max_iterations" as const };
		});

		const result = await executeBuild(defaultFlags, {}, "/project");

		expect(result.specDone).toBe(false);
		expect(result.totalIterations).toBe(2);
		expect(mockUpdateSpecStatus).toHaveBeenCalledWith(expect.anything(), "01-auth", "building");
		// Should NOT be marked done
		expect(mockUpdateSpecStatus).not.toHaveBeenCalledWith(expect.anything(), "01-auth", "done");
	});

	it("completes full build lifecycle: discover → validate prd → build → update status → return result", async () => {
		const spec = { name: "01-auth", path: "/project/specs/01-auth.md", order: { num: 1, suffix: null }, status: "planned" as const };
		mockDiscoverSpecs.mockReturnValue([spec]);
		mockFindSpec.mockReturnValue(spec);
		mockLoadSpecContent.mockReturnValue({ ...spec, content: "# Auth\nFull spec content" });
		mockReadStatus.mockReturnValue({
			specs: {
				"01-auth": {
					status: "planned",
					plannedAt: "2026-03-20T00:00:00.000Z",
					iterations: [],
				},
			},
		});

		// Use default mockAddIteration (adds iterations to status) — no override needed

		let iterationCount = 0;
		mockRunLoop.mockImplementation(async (options: LoopOptions) => {
			const iterations = [];
			for (let i = 1; i <= 3; i++) {
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
				options.onIterationStart?.(iterResult.iteration, iterResult.sessionId);
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

		const result = await executeBuild(
			{ spec: "auth", all: false, verbose: false },
			callbacks,
			"/project",
		);

		expect(mockLoadConfig).toHaveBeenCalledWith("/project");
		expect(mockDiscoverSpecs).toHaveBeenCalledWith("/project", expect.anything());
		expect(mockFindSpec).toHaveBeenCalledWith(expect.anything(), "auth");
		expect(mockRunLoop).toHaveBeenCalledOnce();
		expect(iterationCount).toBe(3);
		expect(mockAddIteration).toHaveBeenCalledTimes(3);
		expect(mockUpdateSpecStatus).toHaveBeenCalledWith(expect.anything(), "01-auth", "building");
		expect(mockWriteStatus).toHaveBeenCalledTimes(9); // 1 session create + 3 onIterationStart + 3 onIterationComplete + 1 final spec status + 1 session interrupted

		expect(result.specName).toBe("01-auth");

		expect(callbacks.onPhase).toHaveBeenCalledWith("building");
		expect(callbacks.onIteration).toHaveBeenCalledTimes(4); // initial + 3 iteration completions
	});
});

describe("resolveResumeSessionId", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		setupDefaults();
	});

	it("returns sessionId when CLI matches and last iteration has sessionId", async () => {
		mockResolveCommandConfig.mockReturnValue({ cli: "claude", model: "default", iterations: 10 });
		mockReadStatus.mockReturnValue({
			session: { name: "warm-lynx-52", cli: "claude", specs: ["01-auth"], state: "interrupted", startedAt: "2026-03-20T00:00:00.000Z" },
			specs: {
				"01-auth": {
					status: "building",
					plannedAt: "2026-03-20T00:00:00.000Z",
					iterations: [
						{ type: "build", iteration: 1, sessionId: "crash-session-id", state: "in_progress", cli: "claude", model: "default", startedAt: "2026-03-20T00:00:00.000Z", completedAt: null, exitCode: null, taskCompleted: null, tokensUsed: null },
					],
				},
			},
		});

		await executeBuild(defaultFlags, {}, "/project");

		const opts = mockRunLoop.mock.calls[0][0];
		expect(opts.sessionId).toBe("crash-session-id");
	});

	it("returns undefined when CLI differs", async () => {
		mockResolveCommandConfig.mockReturnValue({ cli: "opencode", model: "default", iterations: 10 });
		mockReadStatus.mockReturnValue({
			session: { name: "warm-lynx-52", cli: "claude", specs: ["01-auth"], state: "interrupted", startedAt: "2026-03-20T00:00:00.000Z" },
			specs: {
				"01-auth": {
					status: "building",
					plannedAt: "2026-03-20T00:00:00.000Z",
					iterations: [
						{ type: "build", iteration: 1, sessionId: "crash-session-id", state: "in_progress", cli: "claude", model: "default", startedAt: "2026-03-20T00:00:00.000Z", completedAt: null, exitCode: null, taskCompleted: null, tokensUsed: null },
					],
				},
			},
		});

		await executeBuild({ ...defaultFlags, cli: "opencode" }, {}, "/project");

		const opts = mockRunLoop.mock.calls[0][0];
		expect(opts.sessionId).toBeUndefined();
	});

	it("returns undefined when spec has no iterations", async () => {
		mockReadStatus.mockReturnValue({
			specs: {
				"01-auth": {
					status: "planned",
					plannedAt: "2026-03-20T00:00:00.000Z",
					iterations: [],
				},
			},
		});

		await executeBuild(defaultFlags, {}, "/project");

		const opts = mockRunLoop.mock.calls[0][0];
		expect(opts.sessionId).toBeUndefined();
	});

	it("session name reused from session object", async () => {
		mockReadStatus.mockReturnValue({
			session: { name: "warm-lynx-52", cli: "claude", specs: ["01-auth"], state: "interrupted", startedAt: "2026-03-20T00:00:00.000Z" },
			specs: {
				"01-auth": {
					status: "building",
					plannedAt: "2026-03-20T00:00:00.000Z",
					iterations: [
						{ type: "build", iteration: 1, sessionId: "s1", state: "in_progress", cli: "claude", model: "default", startedAt: "2026-03-20T00:00:00.000Z", completedAt: null, exitCode: null, taskCompleted: null, tokensUsed: null },
					],
				},
			},
		});

		await executeBuild(defaultFlags, {}, "/project");

		const getPrompt = mockRunLoop.mock.calls[0][0].getPrompt;
		getPrompt(1);
		expect(mockComputeCliVars).toHaveBeenCalledWith(
			expect.objectContaining({ session: "warm-lynx-52" }),
		);
	});

	it("flags.session overrides session.name", async () => {
		mockReadStatus.mockReturnValue({
			session: { name: "warm-lynx-52", cli: "claude", specs: ["01-auth"], state: "interrupted", startedAt: "2026-03-20T00:00:00.000Z" },
			specs: {
				"01-auth": {
					status: "building",
					plannedAt: "2026-03-20T00:00:00.000Z",
					iterations: [
						{ type: "build", iteration: 1, sessionId: "s1", state: "in_progress", cli: "claude", model: "default", startedAt: "2026-03-20T00:00:00.000Z", completedAt: null, exitCode: null, taskCompleted: null, tokensUsed: null },
					],
				},
			},
		});

		await executeBuild({ ...defaultFlags, session: "my-custom-session" }, {}, "/project");

		const getPrompt = mockRunLoop.mock.calls[0][0].getPrompt;
		getPrompt(1);
		expect(mockComputeCliVars).toHaveBeenCalledWith(
			expect.objectContaining({ session: "my-custom-session" }),
		);
	});

	it("fresh build → session from computeSpecSlug, sessionId undefined", async () => {
		mockReadStatus.mockReturnValue({
			specs: {
				"01-auth": {
					status: "planned",
					plannedAt: "2026-03-20T00:00:00.000Z",
					iterations: [],
				},
			},
		});

		await executeBuild(defaultFlags, {}, "/project");

		const opts = mockRunLoop.mock.calls[0][0];
		expect(opts.sessionId).toBeUndefined();
		const getPrompt = opts.getPrompt;
		getPrompt(1);
		expect(mockComputeCliVars).toHaveBeenCalledWith(
			expect.objectContaining({ session: "auth" }),
		);
	});

	it("no session object → falls through to computeSpecSlug", async () => {
		mockReadStatus.mockReturnValue({
			specs: {
				"01-auth": {
					status: "building",
					plannedAt: "2026-03-20T00:00:00.000Z",
					iterations: [
						{ type: "build", iteration: 1, sessionId: "s1", state: "in_progress", cli: "claude", model: "default", startedAt: "2026-03-20T00:00:00.000Z", completedAt: null, exitCode: null, taskCompleted: null, tokensUsed: null },
					],
				},
			},
		});

		await executeBuild(defaultFlags, {}, "/project");

		const getPrompt = mockRunLoop.mock.calls[0][0].getPrompt;
		getPrompt(1);
		expect(mockComputeCliVars).toHaveBeenCalledWith(
			expect.objectContaining({ session: "auth" }),
		);
	});

	it("runSpecBuild does not write sessionName or lastCli to status", async () => {
		mockReadStatus.mockReturnValue({
			specs: {
				"01-auth": {
					status: "planned",
					plannedAt: "2026-03-20T00:00:00.000Z",
					iterations: [],
				},
			},
		});

		await executeBuild(defaultFlags, {}, "/project");

		// No writeStatus call should contain sessionName or lastCli
		for (const call of mockWriteStatus.mock.calls) {
			const statusArg = call[0] as Record<string, unknown>;
			expect(statusArg).not.toHaveProperty("sessionName");
			expect(statusArg).not.toHaveProperty("lastCli");
		}
	});

	it("done spec throws error (not buildable)", async () => {
		mockReadStatus.mockReturnValue({
			specs: {
				"01-auth": {
					status: "done",
					plannedAt: "2026-03-20T00:00:00.000Z",
					iterations: [
						{ type: "build", iteration: 1, sessionId: "s1", state: "in_progress", cli: "claude", model: "default", startedAt: "2026-03-20T00:00:00.000Z", completedAt: null, exitCode: null, taskCompleted: null, tokensUsed: null },
					],
				},
			},
		});

		await expect(executeBuild(defaultFlags, {}, "/project")).rejects.toThrow("already done");
	});
});

describe("executeBuildAll", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		setupDefaults();
	});

	it("processes specs in NN- order", async () => {
		const specs = [
			{ name: "02-api", path: "/p/specs/02-api.md", order: { num: 2, suffix: null }, status: "planned" as const },
			{ name: "01-auth", path: "/p/specs/01-auth.md", order: { num: 1, suffix: null }, status: "planned" as const },
		];
		mockDiscoverSpecs.mockReturnValue(specs);
		mockLoadSpecContent.mockImplementation((s) => ({ ...s, content: `# ${s.name}` }));

		// Use sentinel so all specs complete (stop-on-error won't break the loop)
		mockRunLoop.mockImplementation(async (options: LoopOptions) => {
			const iterResult = {
				iteration: 1, sessionId: "sess-1", exitCode: 0, tokensUsed: 150,
				model: "claude-sonnet-4-6", durationMs: 1000, sentinelDetected: true,
			};
			options.onIterationStart?.(1, null);
			options.onIterationComplete?.(iterResult);
			return { iterations: [iterResult], stopReason: "sentinel" as const };
		});
		mockUpdateSpecStatus.mockImplementation((status, specName) => ({
			...status,
			specs: { ...status.specs, [specName]: { ...status.specs[specName], status: "done" } },
		}));

		const specOrder: string[] = [];
		await executeBuildAll(
			{ all: true, verbose: false },
			{
				onSpecStart: (name) => { specOrder.push(name); },
			},
			"/p",
		);

		expect(specOrder).toEqual(["01-auth", "02-api"]);
	});

	it("resets iteration counter to 1 for each spec", async () => {
		const specs = [
			{ name: "01-auth", path: "/p/specs/01-auth.md", order: { num: 1, suffix: null }, status: "planned" as const },
			{ name: "02-api", path: "/p/specs/02-api.md", order: { num: 2, suffix: null }, status: "planned" as const },
		];
		mockDiscoverSpecs.mockReturnValue(specs);
		mockLoadSpecContent.mockImplementation((s) => ({ ...s, content: `# ${s.name}` }));

		mockRunLoop.mockImplementation(async (options: LoopOptions) => {
			options.getPrompt(1);
			const iterResult = {
				iteration: 1, sessionId: "sess-1", exitCode: 0, tokensUsed: 150,
				model: "claude-sonnet-4-6", durationMs: 1000, sentinelDetected: true,
			};
			options.onIterationStart?.(iterResult.iteration, iterResult.sessionId);
			options.onIterationComplete?.(iterResult);
			return { iterations: [iterResult], stopReason: "sentinel" as const };
		});
		mockUpdateSpecStatus.mockImplementation((status, specName) => ({
			...status,
			specs: { ...status.specs, [specName]: { ...status.specs[specName], status: "done" } },
		}));

		await executeBuildAll({ all: true, verbose: false }, {}, "/p");

		const calls = mockLoadPrompt.mock.calls;
		const authCall = calls.find((c) => c[1].SPEC_NAME === "01-auth");
		const apiCall = calls.find((c) => c[1].SPEC_NAME === "02-api");
		expect(authCall?.[1].ITERATION).toBe("1");
		expect(apiCall?.[1].ITERATION).toBe("1");
	});

	it("uses PROMPT_BUILD template for build-all", async () => {
		const specs = [
			{ name: "01-auth", path: "/p/specs/01-auth.md", order: { num: 1, suffix: null }, status: "planned" as const },
		];
		mockDiscoverSpecs.mockReturnValue(specs);

		mockRunLoop.mockImplementation(async (options: LoopOptions) => {
			options.getPrompt(1);
			const iterResult = {
				iteration: 1, sessionId: "sess-1", exitCode: 0, tokensUsed: 150,
				model: "claude-sonnet-4-6", durationMs: 1000, sentinelDetected: false,
			};
			options.onIterationStart?.(iterResult.iteration, iterResult.sessionId);
			options.onIterationComplete?.(iterResult);
			return { iterations: [iterResult], stopReason: "max_iterations" as const };
		});

		await executeBuildAll({ all: true, verbose: false }, {}, "/p");

		expect(mockLoadPrompt).toHaveBeenCalledWith(
			"PROMPT_BUILD",
			expect.objectContaining({ SPEC_NAME: "01-auth", SPEC_COUNT: "1", SPEC_INDEX: "1" }),
			{ cwd: "/p" },
		);
	});

	it("errors when no planned specs found", async () => {
		const specs = [
			{ name: "01-auth", path: "/p/specs/01-auth.md", order: { num: 1, suffix: null }, status: "pending" as const },
		];
		mockDiscoverSpecs.mockReturnValue(specs);

		await expect(
			executeBuildAll({ all: true, verbose: false }, {}, "/p"),
		).rejects.toThrow("No planned specs found. Run 'toby plan' first.");
	});

	it("returns per-spec results", async () => {
		const specs = [
			{ name: "01-auth", path: "/p/specs/01-auth.md", order: { num: 1, suffix: null }, status: "planned" as const },
			{ name: "02-api", path: "/p/specs/02-api.md", order: { num: 2, suffix: null }, status: "pending" as const },
		];
		mockDiscoverSpecs.mockReturnValue(specs);
		mockLoadSpecContent.mockImplementation((s) => ({ ...s, content: `# ${s.name}` }));

		const result = await executeBuildAll({ all: true, verbose: false }, {}, "/p");

		expect(result.built).toHaveLength(1);
		expect(result.built[0].specName).toBe("01-auth");
	});

	it("buildAll with session object → session name reused from session.name", async () => {
		const specs = [
			{ name: "01-auth", path: "/p/specs/01-auth.md", order: { num: 1, suffix: null }, status: "building" as const },
		];
		mockDiscoverSpecs.mockReturnValue(specs);
		mockReadStatus.mockReturnValue({
			session: { name: "warm-lynx-52", cli: "claude", specs: ["01-auth"], state: "interrupted", startedAt: "2026-03-20T00:00:00.000Z" },
			specs: {
				"01-auth": {
					status: "building",
					plannedAt: "2026-03-20T00:00:00.000Z",
					iterations: [
						{ type: "build", iteration: 1, sessionId: "s1", state: "in_progress", cli: "claude", model: "default", startedAt: "2026-03-20T00:00:00.000Z", completedAt: null, exitCode: null, taskCompleted: null, tokensUsed: null },
					],
				},
			},
		});

		await executeBuildAll({ all: true, verbose: false }, {}, "/p");

		const getPrompt = mockRunLoop.mock.calls[0][0].getPrompt;
		getPrompt(1);
		expect(mockComputeCliVars).toHaveBeenCalledWith(
			expect.objectContaining({ session: "warm-lynx-52" }),
		);
	});

	it("buildAll with same CLI → per-spec sessionId passed", async () => {
		const specs = [
			{ name: "01-auth", path: "/p/specs/01-auth.md", order: { num: 1, suffix: null }, status: "building" as const },
		];
		mockDiscoverSpecs.mockReturnValue(specs);
		mockResolveCommandConfig.mockReturnValue({ cli: "claude", model: "default", iterations: 10 });
		mockReadStatus.mockReturnValue({
			session: { name: "warm-lynx-52", cli: "claude", specs: ["01-auth"], state: "interrupted", startedAt: "2026-03-20T00:00:00.000Z" },
			specs: {
				"01-auth": {
					status: "building",
					plannedAt: "2026-03-20T00:00:00.000Z",
					iterations: [
						{ type: "build", iteration: 1, sessionId: "crash-sess-id", state: "in_progress", cli: "claude", model: "default", startedAt: "2026-03-20T00:00:00.000Z", completedAt: null, exitCode: null, taskCompleted: null, tokensUsed: null },
					],
				},
			},
		});

		await executeBuildAll({ all: true, verbose: false }, {}, "/p");

		expect(mockRunLoop.mock.calls[0][0].sessionId).toBe("crash-sess-id");
	});

	it("buildAll with different CLI → per-spec sessionId undefined", async () => {
		const specs = [
			{ name: "01-auth", path: "/p/specs/01-auth.md", order: { num: 1, suffix: null }, status: "building" as const },
		];
		mockDiscoverSpecs.mockReturnValue(specs);
		mockResolveCommandConfig.mockReturnValue({ cli: "opencode", model: "default", iterations: 10 });
		mockReadStatus.mockReturnValue({
			session: { name: "warm-lynx-52", cli: "claude", specs: ["01-auth"], state: "interrupted", startedAt: "2026-03-20T00:00:00.000Z" },
			specs: {
				"01-auth": {
					status: "building",
					plannedAt: "2026-03-20T00:00:00.000Z",
					iterations: [
						{ type: "build", iteration: 1, sessionId: "crash-sess-id", state: "in_progress", cli: "claude", model: "default", startedAt: "2026-03-20T00:00:00.000Z", completedAt: null, exitCode: null, taskCompleted: null, tokensUsed: null },
					],
				},
			},
		});

		await executeBuildAll({ all: true, verbose: false, cli: "opencode" }, {}, "/p");

		expect(mockRunLoop.mock.calls[0][0].sessionId).toBeUndefined();
	});

	it("buildAll with no session → session is newly generated", async () => {
		const specs = [
			{ name: "01-auth", path: "/p/specs/01-auth.md", order: { num: 1, suffix: null }, status: "planned" as const },
		];
		mockDiscoverSpecs.mockReturnValue(specs);
		mockReadStatus.mockReturnValue({
			specs: {
				"01-auth": {
					status: "planned",
					plannedAt: "2026-03-20T00:00:00.000Z",
					iterations: [],
				},
			},
		});

		await executeBuildAll({ all: true, verbose: false }, {}, "/p");

		const getPrompt = mockRunLoop.mock.calls[0][0].getPrompt;
		getPrompt(1);
		expect(mockComputeCliVars).toHaveBeenCalledWith(
			expect.objectContaining({ session: "bold-hawk-42" }),
		);
	});

	it("buildAll flags.session overrides session.name", async () => {
		const specs = [
			{ name: "01-auth", path: "/p/specs/01-auth.md", order: { num: 1, suffix: null }, status: "building" as const },
		];
		mockDiscoverSpecs.mockReturnValue(specs);
		mockReadStatus.mockReturnValue({
			session: { name: "warm-lynx-52", cli: "claude", specs: ["01-auth"], state: "interrupted", startedAt: "2026-03-20T00:00:00.000Z" },
			specs: {
				"01-auth": {
					status: "building",
					plannedAt: "2026-03-20T00:00:00.000Z",
					iterations: [
						{ type: "build", iteration: 1, sessionId: "s1", state: "in_progress", cli: "claude", model: "default", startedAt: "2026-03-20T00:00:00.000Z", completedAt: null, exitCode: null, taskCompleted: null, tokensUsed: null },
					],
				},
			},
		});

		await executeBuildAll({ all: true, verbose: false, session: "my-override" }, {}, "/p");

		const getPrompt = mockRunLoop.mock.calls[0][0].getPrompt;
		getPrompt(1);
		expect(mockComputeCliVars).toHaveBeenCalledWith(
			expect.objectContaining({ session: "my-override" }),
		);
	});

	it("silently skips done specs in executeBuildAll", async () => {
		const specs = [
			{ name: "01-auth", path: "/p/specs/01-auth.md", order: { num: 1, suffix: null }, status: "building" as const },
			{ name: "02-api", path: "/p/specs/02-api.md", order: { num: 2, suffix: null }, status: "planned" as const },
			{ name: "03-ui", path: "/p/specs/03-ui.md", order: { num: 3, suffix: null }, status: "planned" as const },
		];
		mockDiscoverSpecs.mockReturnValue(specs);
		// Use sentinel so remaining specs complete
		mockRunLoop.mockImplementation(async (options: LoopOptions) => {
			const iterResult = {
				iteration: 1, sessionId: "sess-1", exitCode: 0, tokensUsed: 150,
				model: "claude-sonnet-4-6", durationMs: 1000, sentinelDetected: true,
			};
			options.onIterationStart?.(1, null);
			options.onIterationComplete?.(iterResult);
			return { iterations: [iterResult], stopReason: "sentinel" as const };
		});
		mockUpdateSpecStatus.mockImplementation((status, specName) => ({
			...status,
			specs: { ...status.specs, [specName]: { ...status.specs[specName], status: "done" } },
		}));
		mockReadStatus.mockReturnValue({
			specs: {
				"01-auth": {
					status: "done",
					plannedAt: "2026-03-20T00:00:00.000Z",
					iterations: [
						{ type: "build", iteration: 1, sessionId: "s1", state: "complete", cli: "claude", model: "default", startedAt: "2026-03-20T00:00:00.000Z", completedAt: "2026-03-20T00:01:00.000Z", exitCode: 0, taskCompleted: null, tokensUsed: 100 },
					],
					stopReason: "sentinel",
				},
				"02-api": {
					status: "planned",
					plannedAt: "2026-03-20T00:00:00.000Z",
					iterations: [],
				},
				"03-ui": {
					status: "planned",
					plannedAt: "2026-03-20T00:00:00.000Z",
					iterations: [],
				},
			},
		});

		const specOrder: string[] = [];
		const result = await executeBuildAll(
			{ all: true, verbose: false },
			{ onSpecStart: (name) => { specOrder.push(name); } },
			"/p",
		);

		// 01-auth is done and should be silently skipped
		expect(specOrder).toEqual(["02-api", "03-ui"]);
		expect(result.built).toHaveLength(2);
	});

	it("specIndex/specCount use planned list when done specs are filtered", async () => {
		const specs = [
			{ name: "01-auth", path: "/p/specs/01-auth.md", order: { num: 1, suffix: null }, status: "building" as const },
			{ name: "02-api", path: "/p/specs/02-api.md", order: { num: 2, suffix: null }, status: "building" as const },
			{ name: "03-ui", path: "/p/specs/03-ui.md", order: { num: 3, suffix: null }, status: "building" as const },
			{ name: "04-data", path: "/p/specs/04-data.md", order: { num: 4, suffix: null }, status: "planned" as const },
			{ name: "05-deploy", path: "/p/specs/05-deploy.md", order: { num: 5, suffix: null }, status: "planned" as const },
		];
		mockDiscoverSpecs.mockReturnValue(specs);
		mockReadStatus.mockReturnValue({
			specs: {
				"01-auth": {
					status: "done",
					plannedAt: "2026-03-20T00:00:00.000Z",
					iterations: [{ type: "build", iteration: 1, sessionId: "s1", state: "complete", cli: "claude", model: "default", startedAt: "2026-03-20T00:00:00.000Z", completedAt: "2026-03-20T00:01:00.000Z", exitCode: 0, taskCompleted: null, tokensUsed: 100 }],
					stopReason: "sentinel",
				},
				"02-api": {
					status: "done",
					plannedAt: "2026-03-20T00:00:00.000Z",
					iterations: [{ type: "build", iteration: 1, sessionId: "s1", state: "complete", cli: "claude", model: "default", startedAt: "2026-03-20T00:00:00.000Z", completedAt: "2026-03-20T00:01:00.000Z", exitCode: 0, taskCompleted: null, tokensUsed: 100 }],
					stopReason: "sentinel",
				},
				"03-ui": {
					status: "done",
					plannedAt: "2026-03-20T00:00:00.000Z",
					iterations: [{ type: "build", iteration: 1, sessionId: "s1", state: "complete", cli: "claude", model: "default", startedAt: "2026-03-20T00:00:00.000Z", completedAt: "2026-03-20T00:01:00.000Z", exitCode: 0, taskCompleted: null, tokensUsed: 100 }],
					stopReason: "sentinel",
				},
				"04-data": {
					status: "building",
					plannedAt: "2026-03-20T00:00:00.000Z",
					iterations: [],
				},
				"05-deploy": {
					status: "planned",
					plannedAt: "2026-03-20T00:00:00.000Z",
					iterations: [],
				},
			},
		});

		// Track getPrompt calls to verify template vars — use sentinel so both specs complete
		mockRunLoop.mockImplementation(async (options: LoopOptions) => {
			options.getPrompt(1);
			const iterResult = {
				iteration: 1, sessionId: "sess-1", exitCode: 0, tokensUsed: 150,
				model: "claude-sonnet-4-6", durationMs: 1000, sentinelDetected: true,
			};
			options.onIterationStart?.(iterResult.iteration, iterResult.sessionId);
			options.onIterationComplete?.(iterResult);
			return { iterations: [iterResult], stopReason: "sentinel" as const };
		});
		mockUpdateSpecStatus.mockImplementation((status, specName) => ({
			...status,
			specs: { ...status.specs, [specName]: { ...status.specs[specName], status: "done" } },
		}));

		await executeBuildAll({ all: true, verbose: false }, {}, "/p");

		// First buildable spec (04-data) should have specIndex=4, specCount=5
		expect(mockComputeCliVars).toHaveBeenCalledWith(
			expect.objectContaining({ specIndex: 4, specCount: 5, specName: "04-data" }),
		);
		// Second buildable spec (05-deploy) should have specIndex=5, specCount=5
		expect(mockComputeCliVars).toHaveBeenCalledWith(
			expect.objectContaining({ specIndex: 5, specCount: 5, specName: "05-deploy" }),
		);
	});

	it("no warnings when all specs are clean", async () => {
		const specs = [
			{ name: "01-auth", path: "/p/specs/01-auth.md", order: { num: 1, suffix: null }, status: "building" as const },
			{ name: "02-api", path: "/p/specs/02-api.md", order: { num: 2, suffix: null }, status: "planned" as const },
		];
		mockDiscoverSpecs.mockReturnValue(specs);
		// Use sentinel so all specs complete without interruption summary
		mockRunLoop.mockImplementation(async (options: LoopOptions) => {
			const iterResult = {
				iteration: 1, sessionId: "sess-1", exitCode: 0, tokensUsed: 150,
				model: "claude-sonnet-4-6", durationMs: 1000, sentinelDetected: true,
			};
			options.onIterationStart?.(1, null);
			options.onIterationComplete?.(iterResult);
			return { iterations: [iterResult], stopReason: "sentinel" as const };
		});
		mockUpdateSpecStatus.mockImplementation((status, specName) => ({
			...status,
			specs: { ...status.specs, [specName]: { ...status.specs[specName], status: "done" } },
		}));
		mockReadStatus.mockReturnValue({
			specs: {
				"01-auth": {
					status: "building",
					plannedAt: "2026-03-20T00:00:00.000Z",
					iterations: [
						{ type: "build", iteration: 1, sessionId: "s1", state: "complete", cli: "claude", model: "default", startedAt: "2026-03-20T00:00:00.000Z", completedAt: "2026-03-20T00:01:00.000Z", exitCode: 0, taskCompleted: null, tokensUsed: 100 },
					],
					stopReason: "sentinel",
				},
				"02-api": {
					status: "planned",
					plannedAt: "2026-03-20T00:00:00.000Z",
					iterations: [],
				},
			},
		});

		const onOutput = vi.fn();
		await executeBuildAll({ all: true, verbose: false }, { onOutput }, "/p");

		expect(onOutput).not.toHaveBeenCalled();
	});
});

describe("session lifecycle", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		setupDefaults();
	});

	it("executeBuild with done spec throws error with correct message", async () => {
		mockReadStatus.mockReturnValue({
			specs: {
				"01-auth": {
					status: "done",
					plannedAt: "2026-03-20T00:00:00.000Z",
					iterations: [
						{ type: "build", iteration: 1, sessionId: "s1", state: "complete", cli: "claude", model: "default", startedAt: "2026-03-20T00:00:00.000Z", completedAt: "2026-03-20T00:01:00.000Z", exitCode: 0, taskCompleted: null, tokensUsed: 100 },
					],
					stopReason: "sentinel",
				},
			},
		});

		await expect(executeBuild(defaultFlags, {}, "/project")).rejects.toThrow(
			"Spec '01-auth' is already done. Reset its status in .toby/status.json to rebuild.",
		);
	});

	it("executeBuild creates session before build starts", async () => {
		await executeBuild(defaultFlags, {}, "/project");

		expect(mockCreateSession).toHaveBeenCalledWith("auth", "claude", ["01-auth"]);
		expect(mockWriteStatus).toHaveBeenCalledWith(
			expect.objectContaining({
				session: expect.objectContaining({ name: "auth", cli: "claude", specs: ["01-auth"], state: "active" }),
			}),
			"/project",
		);
	});

	it("executeBuild clears session on sentinel success", async () => {
		mockRunLoop.mockImplementation(async (options: LoopOptions) => {
			const iterResult = {
				iteration: 1, sessionId: "sess-1", exitCode: 0, tokensUsed: 150,
				model: "claude-sonnet-4-6", durationMs: 1000, sentinelDetected: true,
			};
			options.onIterationStart?.(1, null);
			options.onIterationComplete?.(iterResult);
			return { iterations: [iterResult], stopReason: "sentinel" as const };
		});
		mockUpdateSpecStatus.mockImplementation((status) => status);

		await executeBuild(defaultFlags, {}, "/project");

		expect(mockClearSession).toHaveBeenCalled();
	});

	it("executeBuild marks session interrupted on error", async () => {
		mockRunLoop.mockImplementation(async (options: LoopOptions) => {
			const iterResult = {
				iteration: 1, sessionId: "sess-1", exitCode: 1, tokensUsed: 50,
				model: "claude-sonnet-4-6", durationMs: 1000, sentinelDetected: false,
			};
			options.onIterationStart?.(1, null);
			options.onIterationComplete?.(iterResult);
			return { iterations: [iterResult], stopReason: "error" as const };
		});
		mockUpdateSpecStatus.mockImplementation((status) => status);

		await executeBuild(defaultFlags, {}, "/project");

		expect(mockUpdateSessionState).toHaveBeenCalledWith(expect.anything(), "interrupted");
	});

	it("executeBuildAll creates session with all spec names", async () => {
		const specs = [
			{ name: "01-auth", path: "/p/specs/01-auth.md", order: { num: 1, suffix: null }, status: "planned" as const },
			{ name: "02-api", path: "/p/specs/02-api.md", order: { num: 2, suffix: null }, status: "planned" as const },
		];
		mockDiscoverSpecs.mockReturnValue(specs);

		await executeBuildAll({ all: true, verbose: false }, {}, "/p");

		expect(mockCreateSession).toHaveBeenCalledWith(
			"bold-hawk-42", "claude", ["01-auth", "02-api"],
		);
	});

	it("multi-spec all sentinel → session cleared", async () => {
		const specs = [
			{ name: "01-auth", path: "/p/specs/01-auth.md", order: { num: 1, suffix: null }, status: "planned" as const },
			{ name: "02-api", path: "/p/specs/02-api.md", order: { num: 2, suffix: null }, status: "planned" as const },
		];
		mockDiscoverSpecs.mockReturnValue(specs);

		// Both specs complete with sentinel
		mockRunLoop.mockImplementation(async (options: LoopOptions) => {
			const iterResult = {
				iteration: 1, sessionId: "sess-1", exitCode: 0, tokensUsed: 150,
				model: "claude-sonnet-4-6", durationMs: 1000, sentinelDetected: true,
			};
			options.onIterationStart?.(1, null);
			options.onIterationComplete?.(iterResult);
			return { iterations: [iterResult], stopReason: "sentinel" as const };
		});
		mockUpdateSpecStatus.mockImplementation((status, specName) => ({
			...status,
			specs: { ...status.specs, [specName]: { ...status.specs[specName], status: "done" } },
		}));
		// readStatus returns done specs after builds complete
		let callCount = 0;
		mockReadStatus.mockImplementation(() => {
			callCount++;
			// After builds complete, return all done
			if (callCount > 1) {
				return {
					session: { name: "bold-hawk-42", cli: "claude", specs: ["01-auth", "02-api"], state: "active", startedAt: "2026-03-20T00:00:00.000Z" },
					specs: {
						"01-auth": { status: "done", plannedAt: "2026-03-20T00:00:00.000Z", iterations: [], stopReason: "sentinel" },
						"02-api": { status: "done", plannedAt: "2026-03-20T00:00:00.000Z", iterations: [], stopReason: "sentinel" },
					},
				};
			}
			return {
				specs: {
					"01-auth": { status: "planned", plannedAt: "2026-03-20T00:00:00.000Z", iterations: [] },
					"02-api": { status: "planned", plannedAt: "2026-03-20T00:00:00.000Z", iterations: [] },
				},
			};
		});

		await executeBuildAll({ all: true, verbose: false }, {}, "/p");

		expect(mockClearSession).toHaveBeenCalled();
	});

	it("multi-spec where b errors → session interrupted, c never started", async () => {
		const specs = [
			{ name: "01-auth", path: "/p/specs/01-auth.md", order: { num: 1, suffix: null }, status: "planned" as const },
			{ name: "02-api", path: "/p/specs/02-api.md", order: { num: 2, suffix: null }, status: "planned" as const },
			{ name: "03-ui", path: "/p/specs/03-ui.md", order: { num: 3, suffix: null }, status: "planned" as const },
		];
		mockDiscoverSpecs.mockReturnValue(specs);

		let specIndex = 0;
		mockRunLoop.mockImplementation(async (options: LoopOptions) => {
			specIndex++;
			if (specIndex === 2) {
				// Second spec errors
				const iterResult = {
					iteration: 1, sessionId: "sess-1", exitCode: 1, tokensUsed: 50,
					model: "claude-sonnet-4-6", durationMs: 1000, sentinelDetected: false,
				};
				options.onIterationStart?.(1, null);
				options.onIterationComplete?.(iterResult);
				return { iterations: [iterResult], stopReason: "error" as const };
			}
			// First spec succeeds
			const iterResult = {
				iteration: 1, sessionId: "sess-1", exitCode: 0, tokensUsed: 150,
				model: "claude-sonnet-4-6", durationMs: 1000, sentinelDetected: true,
			};
			options.onIterationStart?.(1, null);
			options.onIterationComplete?.(iterResult);
			return { iterations: [iterResult], stopReason: "sentinel" as const };
		});
		mockUpdateSpecStatus.mockImplementation((status) => status);

		const specOrder: string[] = [];
		const result = await executeBuildAll(
			{ all: true, verbose: false },
			{ onSpecStart: (name) => { specOrder.push(name); } },
			"/p",
		);

		// 03-ui should never have been started
		expect(specOrder).toEqual(["01-auth", "02-api"]);
		expect(result.built).toHaveLength(2);
		expect(mockUpdateSessionState).toHaveBeenCalledWith(expect.anything(), "interrupted");
	});

	it("multi-spec where b hits max_iterations → session interrupted, c never started", async () => {
		const specs = [
			{ name: "01-auth", path: "/p/specs/01-auth.md", order: { num: 1, suffix: null }, status: "planned" as const },
			{ name: "02-api", path: "/p/specs/02-api.md", order: { num: 2, suffix: null }, status: "planned" as const },
			{ name: "03-ui", path: "/p/specs/03-ui.md", order: { num: 3, suffix: null }, status: "planned" as const },
		];
		mockDiscoverSpecs.mockReturnValue(specs);

		let specIndex = 0;
		mockRunLoop.mockImplementation(async (options: LoopOptions) => {
			specIndex++;
			if (specIndex === 2) {
				// Second spec hits max_iterations
				const iterResult = {
					iteration: 1, sessionId: "sess-1", exitCode: 0, tokensUsed: 50,
					model: "claude-sonnet-4-6", durationMs: 1000, sentinelDetected: false,
				};
				options.onIterationStart?.(1, null);
				options.onIterationComplete?.(iterResult);
				return { iterations: [iterResult], stopReason: "max_iterations" as const };
			}
			const iterResult = {
				iteration: 1, sessionId: "sess-1", exitCode: 0, tokensUsed: 150,
				model: "claude-sonnet-4-6", durationMs: 1000, sentinelDetected: true,
			};
			options.onIterationStart?.(1, null);
			options.onIterationComplete?.(iterResult);
			return { iterations: [iterResult], stopReason: "sentinel" as const };
		});
		mockUpdateSpecStatus.mockImplementation((status) => status);

		const specOrder: string[] = [];
		await executeBuildAll(
			{ all: true, verbose: false },
			{ onSpecStart: (name) => { specOrder.push(name); } },
			"/p",
		);

		expect(specOrder).toEqual(["01-auth", "02-api"]);
		expect(mockUpdateSessionState).toHaveBeenCalledWith(expect.anything(), "interrupted");
	});

	it("multi-spec max_iterations onOutput shows iteration limit message", async () => {
		const specs = [
			{ name: "01-auth", path: "/p/specs/01-auth.md", order: { num: 1, suffix: null }, status: "planned" as const },
			{ name: "02-api", path: "/p/specs/02-api.md", order: { num: 2, suffix: null }, status: "planned" as const },
		];
		mockDiscoverSpecs.mockReturnValue(specs);

		let specIndex = 0;
		mockRunLoop.mockImplementation(async (options: LoopOptions) => {
			specIndex++;
			if (specIndex === 2) {
				const iterResult = {
					iteration: 1, sessionId: "sess-1", exitCode: 0, tokensUsed: 50,
					model: "claude-sonnet-4-6", durationMs: 1000, sentinelDetected: false,
				};
				options.onIterationStart?.(1, null);
				options.onIterationComplete?.(iterResult);
				return { iterations: [iterResult], stopReason: "max_iterations" as const };
			}
			const iterResult = {
				iteration: 1, sessionId: "sess-1", exitCode: 0, tokensUsed: 150,
				model: "claude-sonnet-4-6", durationMs: 1000, sentinelDetected: true,
			};
			options.onIterationStart?.(1, null);
			options.onIterationComplete?.(iterResult);
			return { iterations: [iterResult], stopReason: "sentinel" as const };
		});
		mockUpdateSpecStatus.mockImplementation((status) => status);

		const onOutput = vi.fn();
		await executeBuildAll({ all: true, verbose: false }, { onOutput }, "/p");

		expect(onOutput).toHaveBeenCalledWith(
			expect.stringContaining("maximum iteration limit reached"),
		);
		expect(onOutput).toHaveBeenCalledWith(
			expect.stringContaining("interrupted at 02-api"),
		);
	});

	it("interruption output shows completed/remaining counts and toby resume hint", async () => {
		const specs = [
			{ name: "01-auth", path: "/p/specs/01-auth.md", order: { num: 1, suffix: null }, status: "planned" as const },
			{ name: "02-api", path: "/p/specs/02-api.md", order: { num: 2, suffix: null }, status: "planned" as const },
			{ name: "03-ui", path: "/p/specs/03-ui.md", order: { num: 3, suffix: null }, status: "planned" as const },
		];
		mockDiscoverSpecs.mockReturnValue(specs);

		let specIndex = 0;
		mockRunLoop.mockImplementation(async (options: LoopOptions) => {
			specIndex++;
			if (specIndex === 2) {
				// Second spec (02-api) errors
				const iterResult = {
					iteration: 1, sessionId: "sess-1", exitCode: 1, tokensUsed: 50,
					model: "claude-sonnet-4-6", durationMs: 1000, sentinelDetected: false,
				};
				options.onIterationStart?.(1, null);
				options.onIterationComplete?.(iterResult);
				return { iterations: [iterResult], stopReason: "error" as const };
			}
			// First spec (01-auth) succeeds
			const iterResult = {
				iteration: 1, sessionId: "sess-1", exitCode: 0, tokensUsed: 150,
				model: "claude-sonnet-4-6", durationMs: 1000, sentinelDetected: true,
			};
			options.onIterationStart?.(1, null);
			options.onIterationComplete?.(iterResult);
			return { iterations: [iterResult], stopReason: "sentinel" as const };
		});
		mockUpdateSpecStatus.mockImplementation((status) => status);

		// Initial readStatus: all planned (nothing filtered as done)
		// Re-reads inside interruption: 01-auth completed
		let readCount = 0;
		mockReadStatus.mockImplementation(() => {
			readCount++;
			if (readCount === 1) {
				// Initial read: all planned
				return {
					specs: {
						"01-auth": { status: "planned", plannedAt: "2026-03-20T00:00:00.000Z", iterations: [] },
						"02-api": { status: "planned", plannedAt: "2026-03-20T00:00:00.000Z", iterations: [] },
						"03-ui": { status: "planned", plannedAt: "2026-03-20T00:00:00.000Z", iterations: [] },
					},
				};
			}
			// Subsequent reads (during/after builds): 01-auth is done
			return {
				session: { name: "bold-hawk-42", cli: "claude", specs: ["01-auth", "02-api", "03-ui"], state: "active", startedAt: "2026-03-20T00:00:00.000Z" },
				specs: {
					"01-auth": { status: "done", plannedAt: "2026-03-20T00:00:00.000Z", iterations: [], stopReason: "sentinel" },
					"02-api": { status: "building", plannedAt: "2026-03-20T00:00:00.000Z", iterations: [] },
					"03-ui": { status: "planned", plannedAt: "2026-03-20T00:00:00.000Z", iterations: [] },
				},
			};
		});

		const onOutput = vi.fn();
		await executeBuildAll({ all: true, verbose: false }, { onOutput }, "/p");

		expect(onOutput).toHaveBeenCalledWith(
			expect.stringContaining("interrupted at 02-api"),
		);
		expect(onOutput).toHaveBeenCalledWith(
			expect.stringContaining("1/3"),
		);
		expect(onOutput).toHaveBeenCalledWith(
			expect.stringContaining("toby resume"),
		);
	});

	it("Ctrl+C sets session.state to interrupted", async () => {
		const specs = [
			{ name: "01-auth", path: "/p/specs/01-auth.md", order: { num: 1, suffix: null }, status: "planned" as const },
		];
		mockDiscoverSpecs.mockReturnValue(specs);
		mockRunLoop.mockImplementation(async () => {
			throw new AbortError("01-auth", 1);
		});

		await expect(
			executeBuildAll({ all: true, verbose: false }, {}, "/p"),
		).rejects.toThrow(AbortError);

		expect(mockUpdateSessionState).toHaveBeenCalledWith(expect.anything(), "interrupted");
	});

	it("executeBuildAll resumes existing session without recreating", async () => {
		const specs = [
			{ name: "01-auth", path: "/p/specs/01-auth.md", order: { num: 1, suffix: null }, status: "building" as const },
		];
		mockDiscoverSpecs.mockReturnValue(specs);
		mockReadStatus.mockReturnValue({
			session: { name: "warm-lynx-52", cli: "claude", specs: ["01-auth"], state: "interrupted", startedAt: "2026-03-20T00:00:00.000Z" },
			specs: {
				"01-auth": {
					status: "building",
					plannedAt: "2026-03-20T00:00:00.000Z",
					iterations: [],
				},
			},
		});

		await executeBuildAll({ all: true, verbose: false }, {}, "/p");

		// Should NOT create a new session
		expect(mockCreateSession).not.toHaveBeenCalled();
		// Should update state to active
		expect(mockUpdateSessionState).toHaveBeenCalledWith(expect.anything(), "active");
	});

	it("existingIterations computed from specEntry.iterations.length", async () => {
		mockReadStatus.mockReturnValue({
			specs: {
				"01-auth": {
					status: "building",
					plannedAt: "2026-03-20T00:00:00.000Z",
					iterations: [
						{ type: "build", iteration: 1, sessionId: "s1", state: "complete", cli: "claude", model: "default", startedAt: "2026-03-20T00:00:00.000Z", completedAt: "2026-03-20T00:01:00.000Z", exitCode: 0, taskCompleted: null, tokensUsed: 100 },
						{ type: "build", iteration: 2, sessionId: "s1", state: "complete", cli: "claude", model: "default", startedAt: "2026-03-20T00:01:00.000Z", completedAt: "2026-03-20T00:02:00.000Z", exitCode: 0, taskCompleted: null, tokensUsed: 100 },
					],
				},
			},
		});

		// Capture the iteration number passed to computeCliVars
		mockRunLoop.mockImplementation(async (options: LoopOptions) => {
			options.getPrompt(1);
			const iterResult = {
				iteration: 1, sessionId: "sess-1", exitCode: 0, tokensUsed: 150,
				model: "claude-sonnet-4-6", durationMs: 1000, sentinelDetected: false,
			};
			options.onIterationStart?.(1, null);
			options.onIterationComplete?.(iterResult);
			return { iterations: [iterResult], stopReason: "max_iterations" as const };
		});

		await executeBuild(defaultFlags, {}, "/project");

		// iteration 1 + existingIterations 2 = 3
		expect(mockComputeCliVars).toHaveBeenCalledWith(
			expect.objectContaining({ iteration: 3 }),
		);
	});
});

describe("executeBuild transcript", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		setupDefaults();
	});

	it("executeBuild with transcript:true creates transcript file with build in filename", async () => {
		const mockWriter = {
			writeEvent: vi.fn(),
			writeIterationHeader: vi.fn(),
			writeSpecHeader: vi.fn(),
			close: vi.fn(),
			filePath: "/tmp/.toby/transcripts/auth-build-20260324.md",
			stream: {} as any,
			verbose: false,
		};
		mockOpenTranscript.mockReturnValue(mockWriter as any);

		await executeBuild({ ...defaultFlags, transcript: true }, {}, "/project");

		expect(mockOpenTranscript).toHaveBeenCalledWith(
			expect.objectContaining({ command: "build", specName: "01-auth" }),
		);
		expect(mockWriter.writeIterationHeader).toHaveBeenCalled();
		expect(mockWriter.close).toHaveBeenCalled();
	});

	it("executeBuild with transcript:false creates no transcript file", async () => {
		await executeBuild({ ...defaultFlags, transcript: false }, {}, "/project");
		expect(mockOpenTranscript).not.toHaveBeenCalled();
	});

	it("--transcript flag overrides config false", async () => {
		const mockWriter = {
			writeEvent: vi.fn(),
			writeIterationHeader: vi.fn(),
			writeSpecHeader: vi.fn(),
			close: vi.fn(),
			filePath: "/tmp/.toby/transcripts/test.md",
			stream: {} as any,
			verbose: false,
		};
		mockOpenTranscript.mockReturnValue(mockWriter as any);

		// config.transcript is false (default), but flag is true
		await executeBuild({ ...defaultFlags, transcript: true }, {}, "/project");
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

		await executeBuild({ ...defaultFlags, transcript: false }, {}, "/project");
		expect(mockOpenTranscript).not.toHaveBeenCalled();
	});

	it("executeBuild with external writer does not close it", async () => {
		const mockWriter = {
			writeEvent: vi.fn(),
			writeIterationHeader: vi.fn(),
			writeSpecHeader: vi.fn(),
			close: vi.fn(),
			filePath: "/tmp/.toby/transcripts/test.md",
			stream: {} as any,
			verbose: false,
		};

		await executeBuild(defaultFlags, {}, "/project", undefined, mockWriter as any);

		expect(mockWriter.writeIterationHeader).toHaveBeenCalled();
		expect(mockWriter.close).not.toHaveBeenCalled();
		expect(mockOpenTranscript).not.toHaveBeenCalled();
	});
});

describe("executeBuildAll transcript", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		setupDefaults();
	});

	it("executeBuildAll with transcript:true creates one writer with spec headers", async () => {
		const mockWriter = {
			writeEvent: vi.fn(),
			writeIterationHeader: vi.fn(),
			writeSpecHeader: vi.fn(),
			close: vi.fn(),
			filePath: "/tmp/.toby/transcripts/bold-hawk-42-build-20260324.md",
			stream: {} as any,
			verbose: false,
		};
		mockOpenTranscript.mockReturnValue(mockWriter as any);

		const spec1 = { name: "01-auth", path: "/project/specs/01-auth.md", order: { num: 1, suffix: null }, status: "planned" as const };
		const spec2 = { name: "02-api", path: "/project/specs/02-api.md", order: { num: 2, suffix: null }, status: "planned" as const };
		mockDiscoverSpecs.mockReturnValue([spec1, spec2]);
		mockSortSpecs.mockImplementation((specs) => [...specs]);
		mockReadStatus.mockReturnValue({
			specs: {
				"01-auth": { status: "planned", plannedAt: "2026-03-20T00:00:00.000Z", iterations: [] },
				"02-api": { status: "planned", plannedAt: "2026-03-20T00:00:00.000Z", iterations: [] },
			},
		});
		// Use sentinel so both specs run
		mockRunLoop.mockImplementation(async (options: LoopOptions) => {
			const iterResult = {
				iteration: 1, sessionId: "sess-1", exitCode: 0, tokensUsed: 150,
				model: "claude-sonnet-4-6", durationMs: 1000, sentinelDetected: true,
			};
			options.onIterationStart?.(1, null);
			options.onIterationComplete?.(iterResult);
			return { iterations: [iterResult], stopReason: "sentinel" as const };
		});
		mockUpdateSpecStatus.mockImplementation((status, specName) => ({
			...status,
			specs: { ...status.specs, [specName]: { ...status.specs[specName], status: "done" } },
		}));

		await executeBuildAll(
			{ all: true, verbose: false, transcript: true },
			{},
			"/project",
		);

		expect(mockOpenTranscript).toHaveBeenCalledTimes(1);
		expect(mockOpenTranscript).toHaveBeenCalledWith(
			expect.objectContaining({ command: "build" }),
		);

		expect(mockWriter.writeSpecHeader).toHaveBeenCalledTimes(2);
		expect(mockWriter.writeSpecHeader).toHaveBeenCalledWith(1, 2, "01-auth");
		expect(mockWriter.writeSpecHeader).toHaveBeenCalledWith(2, 2, "02-api");

		expect(mockWriter.close).toHaveBeenCalledTimes(1);
	});
});
