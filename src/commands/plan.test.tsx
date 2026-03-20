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
	loadSpecContent: vi.fn(),
}));

vi.mock("../lib/template.js", () => ({
	loadPrompt: vi.fn(),
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

import { loadConfig, resolveCommandConfig } from "../lib/config.js";
import { discoverSpecs, filterByStatus, findSpec, loadSpecContent } from "../lib/specs.js";
import { loadPrompt } from "../lib/template.js";
import { runLoop } from "../lib/loop.js";
import type { LoopOptions } from "../lib/loop.js";
import { readStatus, writeStatus, addIteration, updateSpecStatus } from "../lib/status.js";
import { executePlan, executePlanAll } from "./plan.js";
import { AbortError } from "../lib/errors.js";
import Plan from "./plan.js";
import type { PlanFlags } from "./plan.js";

const mockLoadConfig = vi.mocked(loadConfig);
const mockResolveCommandConfig = vi.mocked(resolveCommandConfig);
const mockDiscoverSpecs = vi.mocked(discoverSpecs);
const mockFilterByStatus = vi.mocked(filterByStatus);
const mockFindSpec = vi.mocked(findSpec);
const mockLoadSpecContent = vi.mocked(loadSpecContent);
const mockLoadPrompt = vi.mocked(loadPrompt);
const mockRunLoop = vi.mocked(runLoop);
const mockReadStatus = vi.mocked(readStatus);
const mockWriteStatus = vi.mocked(writeStatus);
const mockAddIteration = vi.mocked(addIteration);
const mockUpdateSpecStatus = vi.mocked(updateSpecStatus);
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
	});

	mockResolveCommandConfig.mockReturnValue({
		cli: "claude",
		model: "default",
		iterations: 2,
	});

	const spec = {
		name: "01-auth",
		path: "/project/specs/01-auth.md",
		order: 1,
		status: "pending" as const,
	};

	mockDiscoverSpecs.mockReturnValue([spec]);
	mockFilterByStatus.mockImplementation((specs, status) =>
		specs.filter((s) => s.status === status),
	);
	mockFindSpec.mockReturnValue(spec);
	mockLoadSpecContent.mockReturnValue({ ...spec, content: "# Auth Spec\nContent here" });
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

	it("prompt template receives correct substitution variables including empty build-specific vars", async () => {
		await executePlan(defaultFlags, {}, "/project");

		// getPrompt is called inside runLoop; we capture it via the mock
		const getPrompt = mockRunLoop.mock.calls[0][0].getPrompt;
		getPrompt(1);

		expect(mockLoadPrompt).toHaveBeenCalledWith(
			"PROMPT_PLAN",
			{
				SPEC_NAME: "01-auth",
				ITERATION: "1",
				SPEC_CONTENT: "# Auth Spec\nContent here",
				PRD_PATH: "",
				BRANCH: "",
				WORKTREE: "",
				EPIC_NAME: "",
				IS_LAST_SPEC: "",
			},
			"/project",
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
				expect.objectContaining({ ITERATION: "3" }),
				"/project",
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
				expect.objectContaining({ ITERATION: "1" }),
				"/project",
			);
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
		const spec1 = { name: "01-auth", path: "/project/specs/01-auth.md", order: 1, status: "pending" as const };
		const spec2 = { name: "02-api", path: "/project/specs/02-api.md", order: 2, status: "pending" as const };
		mockDiscoverSpecs.mockReturnValue([spec1, spec2]);
		mockFindSpec.mockImplementation((specs, query) => specs.find((s) => s.name === query));
		mockLoadSpecContent.mockImplementation((spec) => ({ ...spec, content: `# ${spec.name}` }));

		const onSpecStart = vi.fn();
		const result = await executePlanAll(
			{ all: true, verbose: false },
			{ onSpecStart },
			"/project",
		);

		expect(result.planned).toHaveLength(2);
		expect(result.planned[0].specName).toBe("01-auth");
		expect(result.planned[1].specName).toBe("02-api");
		expect(result.skipped).toHaveLength(0);
		expect(onSpecStart).toHaveBeenCalledTimes(2);
		expect(onSpecStart).toHaveBeenCalledWith("01-auth", 0, 2);
		expect(onSpecStart).toHaveBeenCalledWith("02-api", 1, 2);
	});

	it("skips already-planned specs", async () => {
		const spec1 = { name: "01-auth", path: "/project/specs/01-auth.md", order: 1, status: "planned" as const };
		const spec2 = { name: "02-api", path: "/project/specs/02-api.md", order: 2, status: "pending" as const };
		mockDiscoverSpecs.mockReturnValue([spec1, spec2]);
		mockFindSpec.mockImplementation((specs, query) => specs.find((s) => s.name === query));
		mockLoadSpecContent.mockImplementation((spec) => ({ ...spec, content: `# ${spec.name}` }));

		const result = await executePlanAll(
			{ all: true, verbose: false },
			{},
			"/project",
		);

		expect(result.planned).toHaveLength(1);
		expect(result.planned[0].specName).toBe("02-api");
		expect(result.skipped).toEqual(["01-auth"]);
	});

	it("stops on first failure", async () => {
		const spec1 = { name: "01-auth", path: "/project/specs/01-auth.md", order: 1, status: "pending" as const };
		const spec2 = { name: "02-api", path: "/project/specs/02-api.md", order: 2, status: "pending" as const };
		mockDiscoverSpecs.mockReturnValue([spec1, spec2]);
		mockFindSpec.mockImplementation((specs, query) => {
			const found = specs.find((s) => s.name === query);
			if (query === "01-auth") return found;
			return undefined; // Simulate not-found for second spec
		});
		mockLoadSpecContent.mockImplementation((spec) => ({ ...spec, content: `# ${spec.name}` }));

		await expect(
			executePlanAll({ all: true, verbose: false }, {}, "/project"),
		).rejects.toThrow("Spec '02-api' not found");

		// Only first spec should have been attempted via runLoop
		expect(mockRunLoop).toHaveBeenCalledTimes(1);
	});

	it("returns empty planned array when all specs are already planned", async () => {
		const spec1 = { name: "01-auth", path: "/project/specs/01-auth.md", order: 1, status: "planned" as const };
		const spec2 = { name: "02-api", path: "/project/specs/02-api.md", order: 2, status: "done" as const };
		mockDiscoverSpecs.mockReturnValue([spec1, spec2]);

		const result = await executePlanAll(
			{ all: true, verbose: false },
			{},
			"/project",
		);

		expect(result.planned).toHaveLength(0);
		expect(result.skipped).toEqual(["01-auth", "02-api"]);
		expect(mockRunLoop).not.toHaveBeenCalled();
	});

	it("throws when no specs found", async () => {
		mockDiscoverSpecs.mockReturnValue([]);

		await expect(
			executePlanAll({ all: true, verbose: false }, {}, "/project"),
		).rejects.toThrow("No specs found in specs/");
	});
});

describe("error handling edge cases", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		setupDefaults();
	});

	it("proceeds with empty spec content", async () => {
		mockLoadSpecContent.mockReturnValue({
			name: "01-auth",
			path: "/project/specs/01-auth.md",
			content: "",
		});

		const result = await executePlan(defaultFlags, {}, "/project");

		expect(mockRunLoop).toHaveBeenCalledOnce();
		const getPrompt = mockRunLoop.mock.calls[0][0].getPrompt;
		getPrompt(1);
		expect(mockLoadPrompt).toHaveBeenCalledWith(
			"PROMPT_PLAN",
			expect.objectContaining({ SPEC_CONTENT: "" }),
			"/project",
		);
		expect(result.specName).toBe("01-auth");
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

		const spec1 = { name: "01-auth", path: "/project/specs/01-auth.md", order: 1, status: "pending" as const };
		mockDiscoverSpecs.mockReturnValue([spec1]);
		mockFindSpec.mockReturnValue(spec1);
		mockLoadSpecContent.mockReturnValue({ ...spec1, content: "# Auth" });

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
			{ name: "01-auth", path: "/project/specs/01-auth.md", order: 1, status: "pending" as const },
			{ name: "02-api", path: "/project/specs/02-api.md", order: 2, status: "pending" as const },
		];
		mockDiscoverSpecs.mockReturnValue(specs);

		const { lastFrame } = render(
			<Plan all={false} verbose={false} />,
		);

		// Wait for useEffect to discover specs and re-render with SpecSelector
		await vi.waitFor(() => {
			const output = lastFrame()!;
			expect(output).toContain("Select a spec to plan");
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
		expect(output).not.toContain("Select a spec to plan");
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
});

describe("integration: full plan flow with mocked spawner", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		setupDefaults();
	});

	it("completes full plan lifecycle: discover → load → plan → update status → return result", async () => {
		const spec = { name: "01-auth", path: "/project/specs/01-auth.md", order: 1, status: "pending" as const };
		mockDiscoverSpecs.mockReturnValue([spec]);
		mockFindSpec.mockReturnValue(spec);
		mockLoadSpecContent.mockReturnValue({ ...spec, content: "# Auth\nFull spec content" });
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
		expect(mockLoadSpecContent).toHaveBeenCalledWith(spec);
		expect(mockRunLoop).toHaveBeenCalledOnce();
		expect(iterationCount).toBe(2);
		expect(mockAddIteration).toHaveBeenCalledTimes(2);
		expect(mockUpdateSpecStatus).toHaveBeenCalledWith(expect.anything(), "01-auth", "planned");
		expect(mockWriteStatus).toHaveBeenCalledTimes(3); // 2 iterations + 1 final

		// Verify result — simplified PlanResult
		expect(result.specName).toBe("01-auth");
		expect(result).not.toHaveProperty("taskCount");
		expect(result).not.toHaveProperty("prdPath");

		// Verify callbacks fired
		expect(callbacks.onPhase).toHaveBeenCalledWith("planning");
		expect(callbacks.onIteration).toHaveBeenCalledTimes(3); // initial + 2 iteration completions
	});
});
