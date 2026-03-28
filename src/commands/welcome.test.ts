import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { runWelcome } from "./welcome.js";

vi.mock("../ui/tty.js", () => ({
	isTTY: vi.fn(),
}));

vi.mock("../lib/stats.js", () => ({
	computeProjectStats: vi.fn(),
}));

vi.mock("@clack/prompts", () => ({
	select: vi.fn(),
	isCancel: vi.fn(),
	cancel: vi.fn(),
}));

// Mock dispatch targets so dynamic imports don't fail
vi.mock("./status.js", () => ({
	runStatus: vi.fn(),
}));

import { isTTY } from "../ui/tty.js";
import { computeProjectStats } from "../lib/stats.js";
import * as clack from "@clack/prompts";
import { runStatus } from "./status.js";

let logOutput: string[];

beforeEach(() => {
	logOutput = [];
	vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
		logOutput.push(args.map(String).join(" "));
	});
	vi.mocked(isTTY).mockReturnValue(true);
	vi.mocked(computeProjectStats).mockReturnValue(null);
	vi.mocked(clack.isCancel).mockReturnValue(false);
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe("runWelcome", () => {
	it("shows help text in non-TTY mode", async () => {
		vi.mocked(isTTY).mockReturnValue(false);
		await runWelcome("1.0.0");
		const text = logOutput.join("\n");
		expect(text).toContain("toby v1.0.0");
		expect(text).toContain("Commands:");
		expect(text).toContain("plan");
		expect(text).toContain("build");
		expect(text).toContain("status");
		expect(clack.select).not.toHaveBeenCalled();
	});

	it("shows banner with version in TTY mode", async () => {
		vi.mocked(clack.select).mockResolvedValue("status");
		vi.mocked(runStatus).mockResolvedValue();
		await runWelcome("2.5.0");
		const text = logOutput.join("\n");
		expect(text).toContain("2.5.0");
	});

	it("shows stats when project is initialized", async () => {
		vi.mocked(computeProjectStats).mockReturnValue({
			totalSpecs: 4,
			pending: 1,
			planned: 2,
			building: 0,
			done: 1,
			totalIterations: 6,
			totalTokens: 24750,
			totalInputTokens: 0,
			totalOutputTokens: 0,
			totalCost: 0,
		});
		vi.mocked(clack.select).mockResolvedValue("status");
		vi.mocked(runStatus).mockResolvedValue();
		await runWelcome("1.0.0");
		const text = logOutput.join("\n");
		expect(text).toContain("4");
		expect(text).toContain("Done:");
	});

	it("dispatches to selected command", async () => {
		vi.mocked(clack.select).mockResolvedValue("status");
		vi.mocked(runStatus).mockResolvedValue();
		await runWelcome("1.0.0");
		expect(runStatus).toHaveBeenCalledWith({ version: "1.0.0" });
	});

	it("handles cancel cleanly", async () => {
		const cancelSymbol = Symbol("cancel");
		vi.mocked(clack.select).mockResolvedValue(cancelSymbol);
		vi.mocked(clack.isCancel).mockReturnValue(true);
		await runWelcome("1.0.0");
		expect(clack.cancel).toHaveBeenCalledWith("Goodbye.");
		expect(runStatus).not.toHaveBeenCalled();
	});
});
