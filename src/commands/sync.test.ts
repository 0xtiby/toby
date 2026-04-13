import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("node:fs", () => ({
	default: {
		readFileSync: vi.fn(),
		existsSync: vi.fn(() => false),
	},
}));

vi.mock("../lib/config.js", () => ({
	loadConfig: vi.fn(),
	validateCliName: vi.fn(),
}));

vi.mock("../lib/template.js", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../lib/template.js")>();
	return {
		...actual,
		resolveSyncPromptPath: vi.fn(),
	};
});

vi.mock("../lib/loop.js", () => ({
	runLoop: vi.fn(),
}));

vi.mock("../ui/stream.js", () => ({
	writeEvent: vi.fn(),
}));

import fs from "node:fs";
import { loadConfig } from "../lib/config.js";
import { resolveSyncPromptPath } from "../lib/template.js";
import { runLoop } from "../lib/loop.js";
import type { LoopOptions } from "../lib/loop.js";
import { executeSync } from "./sync.js";

const defaultConfig = {
	plan: { cli: "claude", model: "default", iterations: 2 },
	build: { cli: "claude", model: "default", iterations: 10 },
	sync: undefined,
	specsDir: "specs",
	excludeSpecs: ["README.md"],
	verbose: false,
	transcript: false,
	templateVars: {},
};

function mockRunLoop(overrides: Partial<{ stopReason: string; tokensUsed: number; cost: number }> = {}) {
	vi.mocked(runLoop).mockResolvedValue({
		iterations: [{
			iteration: 1,
			sessionId: "test-session",
			exitCode: 0,
			tokensUsed: overrides.tokensUsed ?? 1000,
			inputTokens: 800,
			outputTokens: 200,
			cost: overrides.cost ?? 0.01,
			model: "claude-sonnet-4-20250514",
			durationMs: 5000,
			sentinelDetected: true,
		}],
		stopReason: overrides.stopReason ?? "sentinel",
	});
}

describe("executeSync", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(loadConfig).mockReturnValue({ ...defaultConfig });
		vi.mocked(resolveSyncPromptPath).mockReturnValue("/tmp/proj/.toby/PROMPT_SYNC.md");
		vi.mocked(fs.readFileSync).mockReturnValue("Fetch specs from {{SPECS_DIR}}");
		mockRunLoop();
	});

	it("errors when PROMPT_SYNC.md is missing", async () => {
		vi.mocked(resolveSyncPromptPath).mockImplementation(() => {
			throw new Error("Sync prompt not found");
		});

		await expect(executeSync({}, "/tmp/proj")).rejects.toThrow("Sync prompt not found");
		expect(runLoop).not.toHaveBeenCalled();
	});

	it("resolves CLI/model from sync config when present", async () => {
		vi.mocked(loadConfig).mockReturnValue({
			...defaultConfig,
			sync: { cli: "codex", model: "gpt-4" },
		});

		await executeSync({}, "/tmp/proj");

		const loopCall = vi.mocked(runLoop).mock.calls[0]![0] as LoopOptions;
		expect(loopCall.cli).toBe("codex");
		expect(loopCall.model).toBe("gpt-4");
	});

	it("falls back to plan CLI/model when sync config is absent", async () => {
		vi.mocked(loadConfig).mockReturnValue({
			...defaultConfig,
			sync: undefined,
		});

		await executeSync({}, "/tmp/proj");

		const loopCall = vi.mocked(runLoop).mock.calls[0]![0] as LoopOptions;
		expect(loopCall.cli).toBe("claude");
		expect(loopCall.model).toBe("default");
	});

	it("CLI flags override sync and plan config", async () => {
		vi.mocked(loadConfig).mockReturnValue({
			...defaultConfig,
			sync: { cli: "codex", model: "gpt-4" },
		});

		await executeSync({ cli: "opencode", model: "o3" }, "/tmp/proj");

		const loopCall = vi.mocked(runLoop).mock.calls[0]![0] as LoopOptions;
		expect(loopCall.cli).toBe("opencode");
		expect(loopCall.model).toBe("o3");
	});

	it("calls runLoop with maxIterations=1", async () => {
		await executeSync({}, "/tmp/proj");

		const loopCall = vi.mocked(runLoop).mock.calls[0]![0] as LoopOptions;
		expect(loopCall.maxIterations).toBe(1);
	});

	it("passes substituted prompt content to runLoop", async () => {
		await executeSync({}, "/tmp/proj");

		const loopCall = vi.mocked(runLoop).mock.calls[0]![0] as LoopOptions;
		const prompt = loopCall.getPrompt(1);
		expect(prompt).toBe("Fetch specs from specs");
	});

	it("returns token and cost totals from loop result", async () => {
		mockRunLoop({ tokensUsed: 2500, cost: 0.05 });

		const result = await executeSync({}, "/tmp/proj");

		expect(result.totalTokens).toBe(2500);
		expect(result.totalCost).toBe(0.05);
		expect(result.stopReason).toBe("sentinel");
	});
});
