import { describe, it, expect, vi, beforeEach } from "vitest";

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

vi.mock("../lib/prd.js", () => ({
	hasPrd: vi.fn(),
	getPrdPath: vi.fn(),
	readPrd: vi.fn(),
	getTaskSummary: vi.fn(),
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
import { hasPrd, getPrdPath, readPrd, getTaskSummary } from "../lib/prd.js";
import { executePlan, executePlanAll } from "./plan.js";
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
const mockHasPrd = vi.mocked(hasPrd);
const mockGetPrdPath = vi.mocked(getPrdPath);
const mockReadPrd = vi.mocked(readPrd);
const mockGetTaskSummary = vi.mocked(getTaskSummary);

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
	mockHasPrd.mockReturnValue(false);
	mockGetPrdPath.mockReturnValue("/project/.toby/prd/01-auth.json");
	mockLoadPrompt.mockReturnValue("Plan prompt for 01-auth");
	mockReadStatus.mockReturnValue({ specs: {} });
	mockAddIteration.mockImplementation((status) => status);
	mockUpdateSpecStatus.mockImplementation((status) => status);
	mockReadPrd.mockReturnValue(null);

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
				PRD_PATH: "/project/.toby/prd/01-auth.json",
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
		it("detects refinement when prd.json exists for spec", async () => {
			mockHasPrd.mockReturnValue(true);
			mockReadPrd.mockReturnValue({
				spec: "01-auth",
				createdAt: "2026-03-19T00:00:00.000Z",
				tasks: [
					{ id: "t1", title: "Task 1", description: "", acceptanceCriteria: [], files: [], dependencies: [], status: "pending", priority: 1 },
					{ id: "t2", title: "Task 2", description: "", acceptanceCriteria: [], files: [], dependencies: [], status: "done", priority: 2 },
				],
			});
			mockGetTaskSummary.mockReturnValue({ pending: 1, in_progress: 0, done: 1, blocked: 0 });

			const onRefinement = vi.fn();
			await executePlan(defaultFlags, { onRefinement }, "/project");

			expect(onRefinement).toHaveBeenCalledWith("01-auth", 2);
		});

		it("iteration numbering continues from last recorded iteration", async () => {
			mockHasPrd.mockReturnValue(true);
			mockReadPrd.mockReturnValue({
				spec: "01-auth",
				createdAt: "2026-03-19T00:00:00.000Z",
				tasks: [],
			});
			mockGetTaskSummary.mockReturnValue({ pending: 0, in_progress: 0, done: 0, blocked: 0 });
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

		it("normal mode when no prd.json exists", async () => {
			mockHasPrd.mockReturnValue(false);

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
		mockGetPrdPath.mockImplementation((name) => `/project/.toby/prd/${name}.json`);

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
		mockGetPrdPath.mockImplementation((name) => `/project/.toby/prd/${name}.json`);

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
		mockGetPrdPath.mockImplementation((name) => `/project/.toby/prd/${name}.json`);

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
