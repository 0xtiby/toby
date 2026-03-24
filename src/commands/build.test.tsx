import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "ink-testing-library";
import type { CliEvent } from "@0xtiby/spawner";

vi.mock("../lib/config.js", () => ({
	loadConfig: vi.fn(),
	resolveCommandConfig: vi.fn(),
}));

vi.mock("../lib/specs.js", () => ({
	discoverSpecs: vi.fn(),
	filterByStatus: vi.fn(),
	findSpec: vi.fn(),
	loadSpecContent: vi.fn(),
	sortSpecs: vi.fn(),
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
import { discoverSpecs, filterByStatus, findSpec, loadSpecContent, sortSpecs } from "../lib/specs.js";
import { loadPrompt, computeCliVars, resolveTemplateVars, computeSpecSlug, generateSessionName } from "../lib/template.js";
import { runLoop } from "../lib/loop.js";
import type { LoopOptions } from "../lib/loop.js";
import { readStatus, writeStatus, addIteration, updateSpecStatus } from "../lib/status.js";
import { openTranscript } from "../lib/transcript.js";
import { executeBuild, executeBuildAll } from "./build.js";
import { AbortError } from "../lib/errors.js";
import Build from "./build.js";
import type { BuildFlags } from "./build.js";

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
						{ type: "build", iteration: 1, sessionId: "s1", cli: "claude", model: "default", startedAt: "2026-03-19T00:00:00.000Z", completedAt: "2026-03-19T00:00:00.000Z", exitCode: 0, taskCompleted: null, tokensUsed: 100 },
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
		expect(mockWriteStatus).toHaveBeenCalledTimes(3); // 1 onIterationStart + 1 onIterationComplete + 1 final
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
						{ type: "build", iteration: 1, sessionId: "s1", cli: "claude", model: "default", startedAt: "2026-03-19T00:00:00.000Z", completedAt: "2026-03-19T00:00:00.000Z", exitCode: 0, taskCompleted: null, tokensUsed: 100 },
						{ type: "build", iteration: 2, sessionId: "s1", cli: "claude", model: "default", startedAt: "2026-03-19T00:00:00.000Z", completedAt: "2026-03-19T00:00:00.000Z", exitCode: 0, taskCompleted: null, tokensUsed: 100 },
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

describe("Build component", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		setupDefaults();
	});

	it("renders spec selector when no --spec flag provided", async () => {
		const plannedSpec = { name: "01-auth", path: "/project/specs/01-auth.md", order: { num: 1, suffix: null }, status: "planned" as const };
		mockDiscoverSpecs.mockReturnValue([plannedSpec]);

		const { lastFrame } = render(
			<Build all={false} verbose={false} />,
		);

		await vi.waitFor(() => {
			const output = lastFrame()!;
			expect(output).toContain("Select specs to build");
			expect(output).toContain("01-auth");
		});
	});

	it("shows error when no planned specs exist", async () => {
		const pendingSpec = { name: "01-auth", path: "/project/specs/01-auth.md", order: { num: 1, suffix: null }, status: "pending" as const };
		mockDiscoverSpecs.mockReturnValue([pendingSpec]);

		const { lastFrame } = render(
			<Build all={false} verbose={false} />,
		);

		await vi.waitFor(() => {
			const output = lastFrame()!;
			expect(output).toContain("No planned specs found");
		});
	});

	it("only shows planned and building specs in selector", async () => {
		const specs = [
			{ name: "01-auth", path: "/p/specs/01-auth.md", order: { num: 1, suffix: null }, status: "pending" as const },
			{ name: "02-api", path: "/p/specs/02-api.md", order: { num: 2, suffix: null }, status: "planned" as const },
			{ name: "03-ui", path: "/p/specs/03-ui.md", order: { num: 3, suffix: null }, status: "building" as const },
			{ name: "04-done", path: "/p/specs/04-done.md", order: { num: 4, suffix: null }, status: "done" as const },
		];
		mockDiscoverSpecs.mockReturnValue(specs);

		const { lastFrame } = render(
			<Build all={false} verbose={false} />,
		);

		await vi.waitFor(() => {
			const output = lastFrame()!;
			expect(output).toContain("02-api");
			expect(output).toContain("03-ui");
			expect(output).not.toContain("01-auth");
			expect(output).not.toContain("04-done");
		});
	});

	it("completion summary shows iterations and tokens", async () => {
		mockRunLoop.mockImplementation(async (options: LoopOptions) => {
			const iterResult = {
				iteration: 1, sessionId: "sess-1", exitCode: 0, tokensUsed: 500,
				model: "claude-sonnet-4-6", durationMs: 1000, sentinelDetected: false,
			};
			options.onIterationStart?.(iterResult.iteration, iterResult.sessionId);
			options.onIterationComplete?.(iterResult);
			return { iterations: [iterResult], stopReason: "max_iterations" as const };
		});

		const { lastFrame } = render(
			<Build spec="auth" all={false} verbose={false} />,
		);

		await vi.waitFor(() => {
			const output = lastFrame()!;
			expect(output).toContain("Iterations: 1");
			expect(output).toContain("Tokens: 500");
		});
	});

	it("shows error when spec not found", async () => {
		mockFindSpec.mockReturnValue(undefined);

		const { lastFrame } = render(
			<Build spec="nonexistent" all={false} verbose={false} />,
		);

		await vi.waitFor(() => {
			const output = lastFrame()!;
			expect(output).toContain("not found");
		});
	});

	it("shows error when no plan in status.json", async () => {
		mockReadStatus.mockReturnValue({ specs: {} });

		const { lastFrame } = render(
			<Build spec="auth" all={false} verbose={false} />,
		);

		await vi.waitFor(() => {
			const output = lastFrame()!;
			expect(output).toContain("No plan found");
		});
	});

	it("shows error summary on fatal error", async () => {
		mockRunLoop.mockImplementation(async (options: LoopOptions) => {
			const iterResult = {
				iteration: 1, sessionId: "sess-1", exitCode: 1, tokensUsed: 50,
				model: "claude-sonnet-4-6", durationMs: 1000, sentinelDetected: false,
			};
			options.onIterationStart?.(iterResult.iteration, iterResult.sessionId);
			options.onIterationComplete?.(iterResult);
			return { iterations: [iterResult], stopReason: "error" as const };
		});

		const { lastFrame } = render(
			<Build spec="auth" all={false} verbose={false} />,
		);

		await vi.waitFor(() => {
			const output = lastFrame()!;
			expect(output).toContain("Build failed");
		});
	});

	it("default mode filters tool call events from output", async () => {
		let resolveLoop: (value: unknown) => void;
		const loopPromise = new Promise((resolve) => { resolveLoop = resolve; });

		mockRunLoop.mockImplementation(async (options: LoopOptions) => {
			const textEvent: CliEvent = { type: "text", timestamp: Date.now(), content: "Building auth" } as CliEvent;
			const toolEvent: CliEvent = { type: "tool_use", timestamp: Date.now(), content: undefined, tool: { name: "Read" } } as CliEvent;
			options.onEvent?.(textEvent);
			options.onEvent?.(toolEvent);
			await loopPromise;
			const iterResult = {
				iteration: 1, sessionId: "sess-1", exitCode: 0, tokensUsed: 150,
				model: "claude-sonnet-4-6", durationMs: 1000, sentinelDetected: false,
			};
			options.onIterationStart?.(iterResult.iteration, iterResult.sessionId);
			options.onIterationComplete?.(iterResult);
			return { iterations: [iterResult], stopReason: "max_iterations" as const };
		});

		const { lastFrame } = render(
			<Build spec="auth" all={false} verbose={false} />,
		);

		await vi.waitFor(() => {
			const output = lastFrame()!;
			expect(output).toContain("Building auth");
			expect(output).not.toContain("Read");
		});

		resolveLoop!(undefined);
	});

	it("--verbose shows all event types including tool calls", async () => {
		let resolveLoop: (value: unknown) => void;
		const loopPromise = new Promise((resolve) => { resolveLoop = resolve; });

		mockRunLoop.mockImplementation(async (options: LoopOptions) => {
			const textEvent: CliEvent = { type: "text", timestamp: Date.now(), content: "Building auth" } as CliEvent;
			const toolEvent: CliEvent = { type: "tool_use", timestamp: Date.now(), content: undefined, tool: { name: "Read" } } as CliEvent;
			options.onEvent?.(textEvent);
			options.onEvent?.(toolEvent);
			await loopPromise;
			const iterResult = {
				iteration: 1, sessionId: "sess-1", exitCode: 0, tokensUsed: 150,
				model: "claude-sonnet-4-6", durationMs: 1000, sentinelDetected: false,
			};
			options.onIterationStart?.(iterResult.iteration, iterResult.sessionId);
			options.onIterationComplete?.(iterResult);
			return { iterations: [iterResult], stopReason: "max_iterations" as const };
		});

		const { lastFrame } = render(
			<Build spec="auth" all={false} verbose={true} />,
		);

		await vi.waitFor(() => {
			const output = lastFrame()!;
			expect(output).toContain("Building auth");
			expect(output).toContain("Read");
		});

		resolveLoop!(undefined);
	});

	it("config verbose setting used when flag not provided", async () => {
		mockLoadConfig.mockReturnValue({
			plan: { cli: "claude", model: "default", iterations: 2 },
			build: { cli: "claude", model: "default", iterations: 10 },
			specsDir: "specs",
			excludeSpecs: ["README.md"],
			verbose: true,
			templateVars: {},
		});

		let resolveLoop: (value: unknown) => void;
		const loopPromise = new Promise((resolve) => { resolveLoop = resolve; });

		mockRunLoop.mockImplementation(async (options: LoopOptions) => {
			const toolEvent: CliEvent = { type: "tool_use", timestamp: Date.now(), content: undefined, tool: { name: "Bash" } } as CliEvent;
			options.onEvent?.(toolEvent);
			await loopPromise;
			const iterResult = {
				iteration: 1, sessionId: "sess-1", exitCode: 0, tokensUsed: 150,
				model: "claude-sonnet-4-6", durationMs: 1000, sentinelDetected: false,
			};
			options.onIterationStart?.(iterResult.iteration, iterResult.sessionId);
			options.onIterationComplete?.(iterResult);
			return { iterations: [iterResult], stopReason: "max_iterations" as const };
		});

		const { lastFrame } = render(
			<Build spec="auth" all={false} verbose={false} />,
		);

		await vi.waitFor(() => {
			const output = lastFrame()!;
			expect(output).toContain("Bash");
		});

		resolveLoop!(undefined);
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
		expect(mockWriteStatus).toHaveBeenCalledTimes(9); // 4 onIterationStart + 4 onIterationComplete + 1 final
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
				model: "claude-sonnet-4-6", durationMs: 500, sentinelDetected: false,
			};
			options.onIterationStart?.(iterResult.iteration, iterResult.sessionId);
			options.onIterationComplete?.(iterResult);
			return { iterations: [iterResult], stopReason: "max_iterations" as const };
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
		expect(mockWriteStatus).toHaveBeenCalledTimes(7); // 3 onIterationStart + 3 onIterationComplete + 1 final

		expect(result.specName).toBe("01-auth");

		expect(callbacks.onPhase).toHaveBeenCalledWith("building");
		expect(callbacks.onIteration).toHaveBeenCalledTimes(4); // initial + 3 iteration completions
	});
});

describe("executeBuild crash/exhaustion detection", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		setupDefaults();
	});

	it("detects crash when last iteration state is in_progress", async () => {
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

		const callbacks = { onOutput: vi.fn() };
		const result = await executeBuild(defaultFlags, callbacks, "/project");

		expect(callbacks.onOutput).toHaveBeenCalledWith(
			expect.stringContaining("Previous build interrupted"),
		);
		expect(callbacks.onOutput).toHaveBeenCalledWith(
			expect.stringContaining("iteration 1 was in progress"),
		);
		expect(result.needsResume).toBe(true);
	});

	it("detects exhaustion when stopReason is max_iterations", async () => {
		mockReadStatus.mockReturnValue({
			specs: {
				"01-auth": {
					status: "building",
					plannedAt: "2026-03-20T00:00:00.000Z",
					iterations: [
						{ type: "build", iteration: 1, sessionId: "s1", state: "failed", cli: "claude", model: "default", startedAt: "2026-03-20T00:00:00.000Z", completedAt: "2026-03-20T00:01:00.000Z", exitCode: 0, taskCompleted: null, tokensUsed: 100 },
					],
					stopReason: "max_iterations",
				},
			},
		});

		const callbacks = { onOutput: vi.fn() };
		const result = await executeBuild(defaultFlags, callbacks, "/project");

		expect(callbacks.onOutput).toHaveBeenCalledWith(
			expect.stringContaining("exhausted iterations"),
		);
		expect(result.needsResume).toBe(true);
	});

	it("crash message includes correct iteration number", async () => {
		mockReadStatus.mockReturnValue({
			specs: {
				"01-auth": {
					status: "building",
					plannedAt: "2026-03-20T00:00:00.000Z",
					iterations: [
						{ type: "build", iteration: 1, sessionId: "s1", state: "complete", cli: "claude", model: "default", startedAt: "2026-03-20T00:00:00.000Z", completedAt: "2026-03-20T00:00:30.000Z", exitCode: 0, taskCompleted: null, tokensUsed: 100 },
						{ type: "build", iteration: 2, sessionId: "s1", state: "complete", cli: "claude", model: "default", startedAt: "2026-03-20T00:01:00.000Z", completedAt: "2026-03-20T00:01:30.000Z", exitCode: 0, taskCompleted: null, tokensUsed: 100 },
						{ type: "build", iteration: 3, sessionId: "s1", state: "in_progress", cli: "claude", model: "default", startedAt: "2026-03-20T00:02:00.000Z", completedAt: null, exitCode: null, taskCompleted: null, tokensUsed: null },
					],
				},
			},
		});

		const callbacks = { onOutput: vi.fn() };
		const result = await executeBuild(defaultFlags, callbacks, "/project");

		expect(callbacks.onOutput).toHaveBeenCalledWith(
			"⚠ Previous build interrupted (iteration 3 was in progress). Resuming...",
		);
		expect(result.needsResume).toBe(true);
	});

	it("crash takes priority over exhaustion when both conditions are true", async () => {
		mockReadStatus.mockReturnValue({
			specs: {
				"01-auth": {
					status: "building",
					plannedAt: "2026-03-20T00:00:00.000Z",
					iterations: [
						{ type: "build", iteration: 1, sessionId: "s1", state: "in_progress", cli: "claude", model: "default", startedAt: "2026-03-20T00:00:00.000Z", completedAt: null, exitCode: null, taskCompleted: null, tokensUsed: null },
					],
					stopReason: "max_iterations",
				},
			},
		});

		const callbacks = { onOutput: vi.fn() };
		const result = await executeBuild(defaultFlags, callbacks, "/project");

		expect(callbacks.onOutput).toHaveBeenCalledTimes(1);
		expect(callbacks.onOutput).toHaveBeenCalledWith(
			expect.stringContaining("Previous build interrupted"),
		);
		expect(callbacks.onOutput).not.toHaveBeenCalledWith(
			expect.stringContaining("exhausted iterations"),
		);
		expect(result.needsResume).toBe(true);
	});

	it("no resume when stopReason is sentinel", async () => {
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
			},
		});

		const callbacks = { onOutput: vi.fn() };
		const result = await executeBuild(defaultFlags, callbacks, "/project");

		expect(callbacks.onOutput).not.toHaveBeenCalled();
		expect(result.needsResume).toBe(false);
	});

	it("no resume when stopReason is error", async () => {
		mockReadStatus.mockReturnValue({
			specs: {
				"01-auth": {
					status: "building",
					plannedAt: "2026-03-20T00:00:00.000Z",
					iterations: [
						{ type: "build", iteration: 1, sessionId: "s1", state: "failed", cli: "claude", model: "default", startedAt: "2026-03-20T00:00:00.000Z", completedAt: "2026-03-20T00:01:00.000Z", exitCode: 1, taskCompleted: null, tokensUsed: 100 },
					],
					stopReason: "error",
				},
			},
		});

		const callbacks = { onOutput: vi.fn() };
		const result = await executeBuild(defaultFlags, callbacks, "/project");

		expect(callbacks.onOutput).not.toHaveBeenCalled();
		expect(result.needsResume).toBe(false);
	});

	it("no resume when stopReason is aborted", async () => {
		mockReadStatus.mockReturnValue({
			specs: {
				"01-auth": {
					status: "building",
					plannedAt: "2026-03-20T00:00:00.000Z",
					iterations: [
						{ type: "build", iteration: 1, sessionId: "s1", state: "failed", cli: "claude", model: "default", startedAt: "2026-03-20T00:00:00.000Z", completedAt: "2026-03-20T00:01:00.000Z", exitCode: 0, taskCompleted: null, tokensUsed: 100 },
					],
					stopReason: "aborted",
				},
			},
		});

		const callbacks = { onOutput: vi.fn() };
		const result = await executeBuild(defaultFlags, callbacks, "/project");

		expect(callbacks.onOutput).not.toHaveBeenCalled();
		expect(result.needsResume).toBe(false);
	});

	it("no resume when fresh spec has no iterations", async () => {
		// Default setupDefaults has empty iterations array
		const callbacks = { onOutput: vi.fn() };
		const result = await executeBuild(defaultFlags, callbacks, "/project");

		expect(callbacks.onOutput).not.toHaveBeenCalled();
		expect(result.needsResume).toBe(false);
	});

	it("no resume when spec status is done even if last iteration is in_progress", async () => {
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

		// executeBuild throws for non-planned/building status, so this tests that done specs aren't buildable
		await expect(executeBuild(defaultFlags, {}, "/project")).rejects.toThrow("No plan found");
	});

	it("no resume when stopReason is max_iterations but spec status is done", async () => {
		mockReadStatus.mockReturnValue({
			specs: {
				"01-auth": {
					status: "done",
					plannedAt: "2026-03-20T00:00:00.000Z",
					iterations: [
						{ type: "build", iteration: 1, sessionId: "s1", state: "failed", cli: "claude", model: "default", startedAt: "2026-03-20T00:00:00.000Z", completedAt: "2026-03-20T00:01:00.000Z", exitCode: 0, taskCompleted: null, tokensUsed: 100 },
					],
					stopReason: "max_iterations",
				},
			},
		});

		await expect(executeBuild(defaultFlags, {}, "/project")).rejects.toThrow("No plan found");
	});

	it("crash + sessionName in status → session equals status.sessionName", async () => {
		mockReadStatus.mockReturnValue({
			sessionName: "warm-lynx-52",
			lastCli: "claude",
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

	it("crash + same CLI → sessionId passed to runSpecBuild", async () => {
		mockResolveCommandConfig.mockReturnValue({ cli: "claude", model: "default", iterations: 10 });
		mockReadStatus.mockReturnValue({
			sessionName: "warm-lynx-52",
			lastCli: "claude",
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

		// Verify session name is reused and sessionId is passed to runLoop
		const opts = mockRunLoop.mock.calls[0][0];
		expect(opts.sessionId).toBe("crash-session-id");
		const getPrompt = opts.getPrompt;
		getPrompt(1);
		expect(mockComputeCliVars).toHaveBeenCalledWith(
			expect.objectContaining({ session: "warm-lynx-52" }),
		);
	});

	it("crash + different CLI → sessionId is undefined", async () => {
		mockResolveCommandConfig.mockReturnValue({ cli: "opencode", model: "default", iterations: 10 });
		mockReadStatus.mockReturnValue({
			sessionName: "warm-lynx-52",
			lastCli: "claude",
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

		// Session name is still reused (same worktree), but sessionId should not be passed
		const opts = mockRunLoop.mock.calls[0][0];
		expect(opts.sessionId).toBeUndefined();
		const getPrompt = opts.getPrompt;
		getPrompt(1);
		expect(mockComputeCliVars).toHaveBeenCalledWith(
			expect.objectContaining({ session: "warm-lynx-52" }),
		);
	});

	it("exhaustion + same CLI → sessionId is undefined", async () => {
		mockResolveCommandConfig.mockReturnValue({ cli: "claude", model: "default", iterations: 10 });
		mockReadStatus.mockReturnValue({
			sessionName: "warm-lynx-52",
			lastCli: "claude",
			specs: {
				"01-auth": {
					status: "building",
					plannedAt: "2026-03-20T00:00:00.000Z",
					iterations: [
						{ type: "build", iteration: 1, sessionId: "s1", state: "failed", cli: "claude", model: "default", startedAt: "2026-03-20T00:00:00.000Z", completedAt: "2026-03-20T00:01:00.000Z", exitCode: 0, taskCompleted: null, tokensUsed: 100 },
					],
					stopReason: "max_iterations",
				},
			},
		});

		await executeBuild(defaultFlags, {}, "/project");

		// Session name reused but sessionId should NOT be passed (exhaustion = clean exit)
		const opts = mockRunLoop.mock.calls[0][0];
		expect(opts.sessionId).toBeUndefined();
		const getPrompt = opts.getPrompt;
		getPrompt(1);
		expect(mockComputeCliVars).toHaveBeenCalledWith(
			expect.objectContaining({ session: "warm-lynx-52" }),
		);
	});

	it("flags.session overrides status.sessionName", async () => {
		mockReadStatus.mockReturnValue({
			sessionName: "warm-lynx-52",
			lastCli: "claude",
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

	it("only last iteration matters for crash detection", async () => {
		mockReadStatus.mockReturnValue({
			specs: {
				"01-auth": {
					status: "building",
					plannedAt: "2026-03-20T00:00:00.000Z",
					iterations: [
						{ type: "build", iteration: 1, sessionId: "s1", state: "in_progress", cli: "claude", model: "default", startedAt: "2026-03-20T00:00:00.000Z", completedAt: null, exitCode: null, taskCompleted: null, tokensUsed: null },
						{ type: "build", iteration: 2, sessionId: "s1", state: "in_progress", cli: "claude", model: "default", startedAt: "2026-03-20T00:01:00.000Z", completedAt: null, exitCode: null, taskCompleted: null, tokensUsed: null },
						{ type: "build", iteration: 3, sessionId: "s1", state: "complete", cli: "claude", model: "default", startedAt: "2026-03-20T00:02:00.000Z", completedAt: "2026-03-20T00:02:30.000Z", exitCode: 0, taskCompleted: null, tokensUsed: 100 },
					],
				},
			},
		});

		const callbacks = { onOutput: vi.fn() };
		const result = await executeBuild(defaultFlags, callbacks, "/project");

		expect(callbacks.onOutput).not.toHaveBeenCalled();
		expect(result.needsResume).toBe(false);
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
				model: "claude-sonnet-4-6", durationMs: 1000, sentinelDetected: false,
			};
			options.onIterationStart?.(iterResult.iteration, iterResult.sessionId);
			options.onIterationComplete?.(iterResult);
			return { iterations: [iterResult], stopReason: "max_iterations" as const };
		});

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

	it("detects crash per-spec independently in buildAll", async () => {
		const specs = [
			{ name: "01-auth", path: "/p/specs/01-auth.md", order: { num: 1, suffix: null }, status: "planned" as const },
			{ name: "02-api", path: "/p/specs/02-api.md", order: { num: 2, suffix: null }, status: "planned" as const },
		];
		mockDiscoverSpecs.mockReturnValue(specs);
		mockReadStatus.mockReturnValue({
			specs: {
				"01-auth": {
					status: "building",
					plannedAt: "2026-03-20T00:00:00.000Z",
					iterations: [
						{ type: "build", iteration: 1, sessionId: "s1", state: "in_progress", cli: "claude", model: "default", startedAt: "2026-03-20T00:00:00.000Z", completedAt: null, exitCode: null, taskCompleted: null, tokensUsed: null },
					],
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

		expect(onOutput).toHaveBeenCalledTimes(1);
		expect(onOutput).toHaveBeenCalledWith(
			expect.stringContaining("[01-auth] Previous build interrupted"),
		);
	});

	it("detects exhaustion per-spec in buildAll", async () => {
		const specs = [
			{ name: "01-auth", path: "/p/specs/01-auth.md", order: { num: 1, suffix: null }, status: "planned" as const },
		];
		mockDiscoverSpecs.mockReturnValue(specs);
		mockReadStatus.mockReturnValue({
			specs: {
				"01-auth": {
					status: "building",
					plannedAt: "2026-03-20T00:00:00.000Z",
					iterations: [
						{ type: "build", iteration: 1, sessionId: "s1", state: "failed", cli: "claude", model: "default", startedAt: "2026-03-20T00:00:00.000Z", completedAt: "2026-03-20T00:01:00.000Z", exitCode: 0, taskCompleted: null, tokensUsed: 100 },
					],
					stopReason: "max_iterations",
				},
			},
		});

		const onOutput = vi.fn();
		await executeBuildAll({ all: true, verbose: false }, { onOutput }, "/p");

		expect(onOutput).toHaveBeenCalledWith(
			expect.stringContaining("[01-auth] Previous build exhausted iterations"),
		);
	});

	it("handles multiple specs with different resume states independently", async () => {
		const specs = [
			{ name: "01-auth", path: "/p/specs/01-auth.md", order: { num: 1, suffix: null }, status: "building" as const },
			{ name: "02-api", path: "/p/specs/02-api.md", order: { num: 2, suffix: null }, status: "building" as const },
			{ name: "03-ui", path: "/p/specs/03-ui.md", order: { num: 3, suffix: null }, status: "planned" as const },
		];
		mockDiscoverSpecs.mockReturnValue(specs);
		mockReadStatus.mockReturnValue({
			specs: {
				"01-auth": {
					status: "building",
					plannedAt: "2026-03-20T00:00:00.000Z",
					iterations: [
						{ type: "build", iteration: 1, sessionId: "s1", state: "in_progress", cli: "claude", model: "default", startedAt: "2026-03-20T00:00:00.000Z", completedAt: null, exitCode: null, taskCompleted: null, tokensUsed: null },
					],
				},
				"02-api": {
					status: "building",
					plannedAt: "2026-03-20T00:00:00.000Z",
					iterations: [
						{ type: "build", iteration: 1, sessionId: "s1", state: "failed", cli: "claude", model: "default", startedAt: "2026-03-20T00:00:00.000Z", completedAt: "2026-03-20T00:01:00.000Z", exitCode: 0, taskCompleted: null, tokensUsed: 100 },
					],
					stopReason: "max_iterations",
				},
				"03-ui": {
					status: "planned",
					plannedAt: "2026-03-20T00:00:00.000Z",
					iterations: [],
				},
			},
		});

		const onOutput = vi.fn();
		await executeBuildAll({ all: true, verbose: false }, { onOutput }, "/p");

		expect(onOutput).toHaveBeenCalledTimes(2);
		expect(onOutput).toHaveBeenCalledWith(
			expect.stringContaining("[01-auth] Previous build interrupted"),
		);
		expect(onOutput).toHaveBeenCalledWith(
			expect.stringContaining("[02-api] Previous build exhausted iterations"),
		);
	});

	it("buildAll with crashed spec → session equals status.sessionName", async () => {
		const specs = [
			{ name: "01-auth", path: "/p/specs/01-auth.md", order: { num: 1, suffix: null }, status: "building" as const },
		];
		mockDiscoverSpecs.mockReturnValue(specs);
		mockReadStatus.mockReturnValue({
			sessionName: "warm-lynx-52",
			lastCli: "claude",
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

	it("buildAll with crashed spec + same CLI → per-spec sessionId passed", async () => {
		const specs = [
			{ name: "01-auth", path: "/p/specs/01-auth.md", order: { num: 1, suffix: null }, status: "building" as const },
		];
		mockDiscoverSpecs.mockReturnValue(specs);
		mockResolveCommandConfig.mockReturnValue({ cli: "claude", model: "default", iterations: 10 });
		mockReadStatus.mockReturnValue({
			sessionName: "warm-lynx-52",
			lastCli: "claude",
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

	it("buildAll with crashed spec + different CLI → per-spec sessionId undefined", async () => {
		const specs = [
			{ name: "01-auth", path: "/p/specs/01-auth.md", order: { num: 1, suffix: null }, status: "building" as const },
		];
		mockDiscoverSpecs.mockReturnValue(specs);
		mockResolveCommandConfig.mockReturnValue({ cli: "opencode", model: "default", iterations: 10 });
		mockReadStatus.mockReturnValue({
			sessionName: "warm-lynx-52",
			lastCli: "claude",
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

	it("buildAll with no resume needed → session is newly generated", async () => {
		const specs = [
			{ name: "01-auth", path: "/p/specs/01-auth.md", order: { num: 1, suffix: null }, status: "planned" as const },
		];
		mockDiscoverSpecs.mockReturnValue(specs);
		mockReadStatus.mockReturnValue({
			sessionName: "warm-lynx-52",
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

	it("buildAll flags.session overrides status.sessionName", async () => {
		const specs = [
			{ name: "01-auth", path: "/p/specs/01-auth.md", order: { num: 1, suffix: null }, status: "building" as const },
		];
		mockDiscoverSpecs.mockReturnValue(specs);
		mockReadStatus.mockReturnValue({
			sessionName: "warm-lynx-52",
			lastCli: "claude",
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

	it("no warnings when all specs are clean", async () => {
		const specs = [
			{ name: "01-auth", path: "/p/specs/01-auth.md", order: { num: 1, suffix: null }, status: "building" as const },
			{ name: "02-api", path: "/p/specs/02-api.md", order: { num: 2, suffix: null }, status: "planned" as const },
		];
		mockDiscoverSpecs.mockReturnValue(specs);
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
		};
		mockOpenTranscript.mockReturnValue(mockWriter);

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

	it("executeBuild with external writer does not close it", async () => {
		const mockWriter = {
			writeEvent: vi.fn(),
			writeIterationHeader: vi.fn(),
			writeSpecHeader: vi.fn(),
			close: vi.fn(),
			filePath: "/tmp/.toby/transcripts/test.md",
		};

		await executeBuild(defaultFlags, {}, "/project", undefined, mockWriter);

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
		};
		mockOpenTranscript.mockReturnValue(mockWriter);

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
