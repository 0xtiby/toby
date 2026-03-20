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
	sortSpecs: vi.fn(),
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
import { discoverSpecs, filterByStatus, findSpec, loadSpecContent, sortSpecs } from "../lib/specs.js";
import { loadPrompt } from "../lib/template.js";
import { runLoop } from "../lib/loop.js";
import type { LoopOptions } from "../lib/loop.js";
import { readStatus, writeStatus, addIteration, updateSpecStatus } from "../lib/status.js";
import { hasPrd, getPrdPath, readPrd, getTaskSummary } from "../lib/prd.js";
import { executeBuild, executeBuildAll, AbortError } from "./build.js";
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
const mockRunLoop = vi.mocked(runLoop);
const mockReadStatus = vi.mocked(readStatus);
const mockWriteStatus = vi.mocked(writeStatus);
const mockAddIteration = vi.mocked(addIteration);
const mockUpdateSpecStatus = vi.mocked(updateSpecStatus);
const mockHasPrd = vi.mocked(hasPrd);
const mockGetPrdPath = vi.mocked(getPrdPath);
const mockReadPrd = vi.mocked(readPrd);
const mockGetTaskSummary = vi.mocked(getTaskSummary);

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
	});

	mockResolveCommandConfig.mockReturnValue({
		cli: "claude",
		model: "default",
		iterations: 10,
	});

	const spec = {
		name: "01-auth",
		path: "/project/specs/01-auth.md",
		order: 1,
		status: "planned" as const,
	};

	mockDiscoverSpecs.mockReturnValue([spec]);
	mockFilterByStatus.mockImplementation((specs, status) => specs.filter((s) => s.status === status));
	mockSortSpecs.mockImplementation((specs) => [...specs].sort((a, b) => (a.order ?? 0) - (b.order ?? 0)));
	mockFindSpec.mockReturnValue(spec);
	mockLoadSpecContent.mockReturnValue({ ...spec, content: "# Auth Spec\nContent here" });
	mockHasPrd.mockReturnValue(true);
	mockGetPrdPath.mockReturnValue("/project/.toby/prd/01-auth.json");
	mockLoadPrompt.mockReturnValue("Build prompt for 01-auth");
	mockReadStatus.mockReturnValue({ specs: {} });
	mockAddIteration.mockImplementation((status) => status);
	mockUpdateSpecStatus.mockImplementation((status) => status);
	mockReadPrd.mockReturnValue({
		spec: "01-auth",
		createdAt: "2026-03-20T00:00:00.000Z",
		tasks: [
			{ id: "t1", title: "Task 1", description: "", acceptanceCriteria: [], files: [], dependencies: [], status: "pending", priority: 1 },
		],
	});
	mockGetTaskSummary.mockReturnValue({ pending: 1, in_progress: 0, done: 0, blocked: 0 });

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

	it("errors when prd.json is missing for the spec", async () => {
		mockHasPrd.mockReturnValue(false);

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
			{
				SPEC_NAME: "01-auth",
				ITERATION: "1",
				SPEC_CONTENT: "# Auth Spec\nContent here",
				PRD_PATH: "/project/.toby/prd/01-auth.json",
				BRANCH: "",
				WORKTREE: "",
				EPIC_NAME: "",
				IS_LAST_SPEC: "false",
			},
			"/project",
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

	it("status is updated after each iteration completes", async () => {
		await executeBuild(defaultFlags, {}, "/project");

		expect(mockAddIteration).toHaveBeenCalledWith(
			expect.anything(),
			"01-auth",
			expect.objectContaining({
				type: "build",
				iteration: 1,
				sessionId: "sess-1",
				cli: "claude",
			}),
		);
		expect(mockWriteStatus).toHaveBeenCalledTimes(2);
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
			expect.objectContaining({ ITERATION: "3" }),
			"/project",
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
		const plannedSpec = { name: "01-auth", path: "/project/specs/01-auth.md", order: 1, status: "planned" as const };
		mockDiscoverSpecs.mockReturnValue([plannedSpec]);

		const { lastFrame } = render(
			<Build all={false} verbose={false} />,
		);

		await vi.waitFor(() => {
			const output = lastFrame()!;
			expect(output).toContain("Select a spec to build");
			expect(output).toContain("01-auth");
		});
	});

	it("shows error when no planned specs exist", async () => {
		const pendingSpec = { name: "01-auth", path: "/project/specs/01-auth.md", order: 1, status: "pending" as const };
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
			{ name: "01-auth", path: "/p/specs/01-auth.md", order: 1, status: "pending" as const },
			{ name: "02-api", path: "/p/specs/02-api.md", order: 2, status: "planned" as const },
			{ name: "03-ui", path: "/p/specs/03-ui.md", order: 3, status: "building" as const },
			{ name: "04-done", path: "/p/specs/04-done.md", order: 4, status: "done" as const },
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

	it("shows error when prd.json missing", async () => {
		mockHasPrd.mockReturnValue(false);

		const { lastFrame } = render(
			<Build spec="auth" all={false} verbose={false} />,
		);

		await vi.waitFor(() => {
			const output = lastFrame()!;
			expect(output).toContain("No plan found");
		});
	});
});

describe("integration: full build flow with mocked spawner", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		setupDefaults();
	});

	it("completes full build lifecycle: discover → validate prd → build → update status → return result", async () => {
		const spec = { name: "01-auth", path: "/project/specs/01-auth.md", order: 1, status: "planned" as const };
		mockDiscoverSpecs.mockReturnValue([spec]);
		mockFindSpec.mockReturnValue(spec);
		mockLoadSpecContent.mockReturnValue({ ...spec, content: "# Auth\nFull spec content" });
		mockGetPrdPath.mockReturnValue("/project/.toby/prd/01-auth.json");
		mockHasPrd.mockReturnValue(true);
		mockReadStatus.mockReturnValue({ specs: {} });

		const updatedStatus = { specs: { "01-auth": { status: "building", plannedAt: null, iterations: [] } } };
		mockAddIteration.mockReturnValue(updatedStatus);
		mockUpdateSpecStatus.mockReturnValue(updatedStatus);

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
				options.onIterationComplete?.(iterResult);
				iterations.push(iterResult);
			}
			return { iterations, stopReason: "max_iterations" as const };
		});

		mockReadPrd.mockReturnValue({
			spec: "01-auth",
			createdAt: "2026-03-20T00:00:00.000Z",
			tasks: [
				{ id: "t1", title: "Setup auth middleware", description: "", acceptanceCriteria: [], files: [], dependencies: [], status: "pending", priority: 1 },
				{ id: "t2", title: "Add login endpoint", description: "", acceptanceCriteria: [], files: [], dependencies: [], status: "done", priority: 2 },
			],
		});
		mockGetTaskSummary.mockReturnValue({ pending: 1, in_progress: 0, done: 1, blocked: 0 });

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
		expect(mockHasPrd).toHaveBeenCalledWith("01-auth", "/project");
		expect(mockLoadSpecContent).toHaveBeenCalledWith(spec);
		expect(mockRunLoop).toHaveBeenCalledOnce();
		expect(iterationCount).toBe(3);
		expect(mockAddIteration).toHaveBeenCalledTimes(3);
		expect(mockUpdateSpecStatus).toHaveBeenCalledWith(expect.anything(), "01-auth", "building");
		expect(mockWriteStatus).toHaveBeenCalledTimes(4); // 3 iterations + 1 final

		expect(result.specName).toBe("01-auth");
		expect(result.taskCount).toBe(2);
		expect(result.prdPath).toBe("/project/.toby/prd/01-auth.json");

		expect(callbacks.onPhase).toHaveBeenCalledWith("building");
		expect(callbacks.onIteration).toHaveBeenCalledTimes(4); // initial + 3 iteration completions
	});
});

describe("executeBuildAll", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		setupDefaults();
	});

	it("processes specs in NN- order", async () => {
		const specs = [
			{ name: "02-api", path: "/p/specs/02-api.md", order: 2, status: "planned" as const },
			{ name: "01-auth", path: "/p/specs/01-auth.md", order: 1, status: "planned" as const },
		];
		mockDiscoverSpecs.mockReturnValue(specs);
		mockHasPrd.mockReturnValue(true);
		mockLoadSpecContent.mockImplementation((s) => ({ ...s, content: `# ${s.name}` }));
		mockGetPrdPath.mockImplementation((name) => `/p/.toby/prd/${name}.json`);

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
			{ name: "01-auth", path: "/p/specs/01-auth.md", order: 1, status: "planned" as const },
			{ name: "02-api", path: "/p/specs/02-api.md", order: 2, status: "planned" as const },
		];
		mockDiscoverSpecs.mockReturnValue(specs);
		mockHasPrd.mockReturnValue(true);
		mockLoadSpecContent.mockImplementation((s) => ({ ...s, content: `# ${s.name}` }));
		mockGetPrdPath.mockImplementation((name) => `/p/.toby/prd/${name}.json`);

		mockRunLoop.mockImplementation(async (options: LoopOptions) => {
			options.getPrompt(1);
			const iterResult = {
				iteration: 1, sessionId: "sess-1", exitCode: 0, tokensUsed: 150,
				model: "claude-sonnet-4-6", durationMs: 1000, sentinelDetected: false,
			};
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

	it("uses PROMPT_BUILD_ALL template", async () => {
		const specs = [
			{ name: "01-auth", path: "/p/specs/01-auth.md", order: 1, status: "planned" as const },
		];
		mockDiscoverSpecs.mockReturnValue(specs);
		mockHasPrd.mockReturnValue(true);
		mockLoadSpecContent.mockImplementation((s) => ({ ...s, content: `# ${s.name}` }));
		mockGetPrdPath.mockImplementation((name) => `/p/.toby/prd/${name}.json`);

		mockRunLoop.mockImplementation(async (options: LoopOptions) => {
			options.getPrompt(1);
			const iterResult = {
				iteration: 1, sessionId: "sess-1", exitCode: 0, tokensUsed: 150,
				model: "claude-sonnet-4-6", durationMs: 1000, sentinelDetected: false,
			};
			options.onIterationComplete?.(iterResult);
			return { iterations: [iterResult], stopReason: "max_iterations" as const };
		});

		await executeBuildAll({ all: true, verbose: false }, {}, "/p");

		expect(mockLoadPrompt).toHaveBeenCalledWith(
			"PROMPT_BUILD_ALL",
			expect.anything(),
			"/p",
		);
	});

	it("IS_LAST_SPEC is true only for the last spec", async () => {
		const specs = [
			{ name: "01-auth", path: "/p/specs/01-auth.md", order: 1, status: "planned" as const },
			{ name: "02-api", path: "/p/specs/02-api.md", order: 2, status: "planned" as const },
			{ name: "03-ui", path: "/p/specs/03-ui.md", order: 3, status: "planned" as const },
		];
		mockDiscoverSpecs.mockReturnValue(specs);
		mockHasPrd.mockReturnValue(true);
		mockLoadSpecContent.mockImplementation((s) => ({ ...s, content: `# ${s.name}` }));
		mockGetPrdPath.mockImplementation((name) => `/p/.toby/prd/${name}.json`);

		mockRunLoop.mockImplementation(async (options: LoopOptions) => {
			options.getPrompt(1);
			const iterResult = {
				iteration: 1, sessionId: "sess-1", exitCode: 0, tokensUsed: 150,
				model: "claude-sonnet-4-6", durationMs: 1000, sentinelDetected: false,
			};
			options.onIterationComplete?.(iterResult);
			return { iterations: [iterResult], stopReason: "max_iterations" as const };
		});

		await executeBuildAll({ all: true, verbose: false }, {}, "/p");

		const calls = mockLoadPrompt.mock.calls;
		const authCall = calls.find((c) => c[1].SPEC_NAME === "01-auth");
		const apiCall = calls.find((c) => c[1].SPEC_NAME === "02-api");
		const uiCall = calls.find((c) => c[1].SPEC_NAME === "03-ui");
		expect(authCall?.[1].IS_LAST_SPEC).toBe("false");
		expect(apiCall?.[1].IS_LAST_SPEC).toBe("false");
		expect(uiCall?.[1].IS_LAST_SPEC).toBe("true");
	});

	it("errors when no planned specs found", async () => {
		const specs = [
			{ name: "01-auth", path: "/p/specs/01-auth.md", order: 1, status: "pending" as const },
		];
		mockDiscoverSpecs.mockReturnValue(specs);

		await expect(
			executeBuildAll({ all: true, verbose: false }, {}, "/p"),
		).rejects.toThrow("No planned specs found. Run 'toby plan' first.");
	});

	it("returns per-spec results and skipped list", async () => {
		const specs = [
			{ name: "01-auth", path: "/p/specs/01-auth.md", order: 1, status: "planned" as const },
			{ name: "02-api", path: "/p/specs/02-api.md", order: 2, status: "pending" as const },
		];
		mockDiscoverSpecs.mockReturnValue(specs);
		mockHasPrd.mockReturnValue(true);
		mockLoadSpecContent.mockImplementation((s) => ({ ...s, content: `# ${s.name}` }));
		mockGetPrdPath.mockImplementation((name) => `/p/.toby/prd/${name}.json`);

		const result = await executeBuildAll({ all: true, verbose: false }, {}, "/p");

		expect(result.built).toHaveLength(1);
		expect(result.built[0].specName).toBe("01-auth");
		expect(result.skipped).toEqual(["02-api"]);
	});
});
