import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../lib/config.js", () => ({
	loadConfig: vi.fn(),
	resolveCommandConfig: vi.fn(),
}));

vi.mock("../lib/specs.js", () => ({
	discoverSpecs: vi.fn(),
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
import { discoverSpecs, findSpec, loadSpecContent } from "../lib/specs.js";
import { loadPrompt } from "../lib/template.js";
import { runLoop } from "../lib/loop.js";
import type { LoopOptions } from "../lib/loop.js";
import { readStatus, writeStatus, addIteration, updateSpecStatus } from "../lib/status.js";
import { getPrdPath, readPrd, getTaskSummary } from "../lib/prd.js";
import { executePlan } from "./plan.js";
import type { PlanFlags } from "./plan.js";

const mockLoadConfig = vi.mocked(loadConfig);
const mockResolveCommandConfig = vi.mocked(resolveCommandConfig);
const mockDiscoverSpecs = vi.mocked(discoverSpecs);
const mockFindSpec = vi.mocked(findSpec);
const mockLoadSpecContent = vi.mocked(loadSpecContent);
const mockLoadPrompt = vi.mocked(loadPrompt);
const mockRunLoop = vi.mocked(runLoop);
const mockReadStatus = vi.mocked(readStatus);
const mockWriteStatus = vi.mocked(writeStatus);
const mockAddIteration = vi.mocked(addIteration);
const mockUpdateSpecStatus = vi.mocked(updateSpecStatus);
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
	mockFindSpec.mockReturnValue(spec);
	mockLoadSpecContent.mockReturnValue({ ...spec, content: "# Auth Spec\nContent here" });
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
});
