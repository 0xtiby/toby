import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "ink-testing-library";
import type { StatusData, Session } from "../types.js";
import type { Spec } from "../lib/specs.js";
import type { BuildAllCallbacks, BuildAllResult } from "./build.js";

vi.mock("../lib/config.js", () => ({
	loadConfig: vi.fn(),
	resolveCommandConfig: vi.fn(),
}));

vi.mock("../lib/specs.js", () => ({
	discoverSpecs: vi.fn(),
	findSpec: vi.fn(),
}));

vi.mock("../lib/status.js", () => ({
	readStatus: vi.fn(),
	writeStatus: vi.fn(),
	hasResumableSession: vi.fn(),
	updateSessionState: vi.fn((status: StatusData, state: string) => ({
		...status,
		session: status.session ? { ...status.session, state } : undefined,
	})),
}));

vi.mock("./build.js", () => ({
	executeBuildAll: vi.fn(),
}));

import { loadConfig, resolveCommandConfig } from "../lib/config.js";
import { discoverSpecs, findSpec } from "../lib/specs.js";
import { readStatus, writeStatus, hasResumableSession, updateSessionState } from "../lib/status.js";
import { executeBuildAll } from "./build.js";
import { executeResume } from "./resume.js";
import Resume from "./resume.js";

const mockLoadConfig = vi.mocked(loadConfig);
const mockResolveCommandConfig = vi.mocked(resolveCommandConfig);
const mockDiscoverSpecs = vi.mocked(discoverSpecs);
const mockFindSpec = vi.mocked(findSpec);
const mockReadStatus = vi.mocked(readStatus);
const mockWriteStatus = vi.mocked(writeStatus);
const mockHasResumableSession = vi.mocked(hasResumableSession);
const mockUpdateSessionState = vi.mocked(updateSessionState);
const mockExecuteBuildAll = vi.mocked(executeBuildAll);

function makeSession(overrides: Partial<Session> = {}): Session {
	return {
		name: "bold-hawk-42",
		cli: "claude",
		specs: ["42-session-lifecycle", "43-resume-command"],
		state: "interrupted",
		startedAt: "2026-03-20T00:00:00.000Z",
		...overrides,
	};
}

function makeSpec(name: string): Spec {
	return {
		name,
		path: `/specs/${name}.md`,
		order: { num: parseInt(name), suffix: null },
		status: "building",
	};
}

function makeStatus(overrides: Partial<StatusData> = {}): StatusData {
	return {
		specs: {
			"42-session-lifecycle": { status: "done", plannedAt: null, iterations: [] },
			"43-resume-command": { status: "building", plannedAt: null, iterations: [] },
		},
		session: makeSession(),
		...overrides,
	};
}

const defaultConfig = {
	specsDir: "specs",
	excludeSpecs: [] as string[],
	verbose: false,
	transcript: false,
	templateVars: {},
	plan: { cli: "claude" as const, model: "default", iterations: 1 },
	build: { cli: "claude" as const, model: "default", iterations: 5 },
};

const defaultCommandConfig = { cli: "claude" as const, model: "default", iterations: 5 };

describe("executeResume", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockLoadConfig.mockReturnValue(defaultConfig as ReturnType<typeof loadConfig>);
		mockResolveCommandConfig.mockReturnValue(defaultCommandConfig);
		mockDiscoverSpecs.mockReturnValue([
			makeSpec("42-session-lifecycle"),
			makeSpec("43-resume-command"),
		]);
		mockFindSpec.mockImplementation((_specs, query) => {
			const map: Record<string, Spec> = {
				"42-session-lifecycle": makeSpec("42-session-lifecycle"),
				"43-resume-command": makeSpec("43-resume-command"),
			};
			return map[query];
		});
		mockExecuteBuildAll.mockResolvedValue({ built: [] });
	});

	it("throws when no session exists", async () => {
		mockReadStatus.mockReturnValue({ specs: {} });
		mockHasResumableSession.mockReturnValue(false);

		await expect(executeResume({}, {}, "/test")).rejects.toThrow(
			"No active session to resume",
		);
	});

	it("calls executeBuildAll with only incomplete specs", async () => {
		const status = makeStatus();
		mockReadStatus.mockReturnValue(status);
		mockHasResumableSession.mockReturnValue(true);
		mockUpdateSessionState.mockReturnValue({ ...status, session: { ...status.session!, state: "active" } });

		await executeResume({}, {}, "/test");

		expect(mockExecuteBuildAll).toHaveBeenCalledTimes(1);
		const [, , , , specs] = mockExecuteBuildAll.mock.calls[0];
		expect(specs).toHaveLength(1);
		expect(specs![0].name).toBe("43-resume-command");
	});

	it("passes flags.session = session.name to executeBuildAll", async () => {
		const status = makeStatus();
		mockReadStatus.mockReturnValue(status);
		mockHasResumableSession.mockReturnValue(true);
		mockUpdateSessionState.mockReturnValue({ ...status, session: { ...status.session!, state: "active" } });

		await executeResume({}, {}, "/test");

		const [buildFlags] = mockExecuteBuildAll.mock.calls[0];
		expect(buildFlags.session).toBe("bold-hawk-42");
	});

	it("calls updateSessionState before executeBuildAll", async () => {
		const status = makeStatus();
		mockReadStatus.mockReturnValue(status);
		mockHasResumableSession.mockReturnValue(true);
		mockUpdateSessionState.mockReturnValue({ ...status, session: { ...status.session!, state: "active" } });

		const callOrder: string[] = [];
		mockWriteStatus.mockImplementation(() => { callOrder.push("writeStatus"); });
		mockExecuteBuildAll.mockImplementation(async () => {
			callOrder.push("executeBuildAll");
			return { built: [] };
		});

		await executeResume({}, {}, "/test");

		expect(callOrder).toEqual(["writeStatus", "executeBuildAll"]);
		expect(mockUpdateSessionState).toHaveBeenCalledWith(status, "active");
	});

	it("skips done specs in preview output via onOutput", async () => {
		const status = makeStatus();
		mockReadStatus.mockReturnValue(status);
		mockHasResumableSession.mockReturnValue(true);
		mockUpdateSessionState.mockReturnValue({ ...status, session: { ...status.session!, state: "active" } });

		const messages: string[] = [];
		const callbacks: BuildAllCallbacks = {
			onOutput: (msg) => messages.push(msg),
		};

		await executeResume({}, callbacks, "/test");

		expect(messages.some((m) => m.includes("42-session-lifecycle") && m.includes("done"))).toBe(true);
		expect(messages.some((m) => m.includes("43-resume-command") && m.includes("→"))).toBe(true);
	});

	it("throws when all specs are done", async () => {
		const status = makeStatus({
			specs: {
				"42-session-lifecycle": { status: "done", plannedAt: null, iterations: [] },
				"43-resume-command": { status: "done", plannedAt: null, iterations: [] },
			},
		});
		mockReadStatus.mockReturnValue(status);
		mockHasResumableSession.mockReturnValue(true);

		await expect(executeResume({}, {}, "/test")).rejects.toThrow(
			"All specs in this session are already done",
		);
	});

	it("warns and skips session specs not found in specs/ directory", async () => {
		const status = makeStatus({
			session: makeSession({ specs: ["42-session-lifecycle", "43-resume-command", "99-missing"] }),
		});
		mockReadStatus.mockReturnValue(status);
		mockHasResumableSession.mockReturnValue(true);
		mockUpdateSessionState.mockReturnValue({ ...status, session: { ...status.session!, state: "active" } });
		mockFindSpec.mockImplementation((_specs, query) => {
			if (query === "99-missing") return undefined;
			return makeSpec(query);
		});

		const messages: string[] = [];
		await executeResume({}, { onOutput: (m) => messages.push(m) }, "/test");

		expect(messages.some((m) => m.includes("99-missing") && m.includes("not found"))).toBe(true);
	});

	it("throws when all session specs are missing from specs/", async () => {
		const status = makeStatus({
			specs: {},
			session: makeSession({ specs: ["99-missing", "100-also-missing"] }),
		});
		mockReadStatus.mockReturnValue(status);
		mockHasResumableSession.mockReturnValue(true);
		mockFindSpec.mockReturnValue(undefined);

		await expect(executeResume({}, {}, "/test")).rejects.toThrow(
			"All session specs are missing from specs/ directory",
		);
	});

	it("passes --verbose and --transcript through to BuildFlags", async () => {
		const status = makeStatus();
		mockReadStatus.mockReturnValue(status);
		mockHasResumableSession.mockReturnValue(true);
		mockUpdateSessionState.mockReturnValue({ ...status, session: { ...status.session!, state: "active" } });

		await executeResume({ verbose: true, transcript: true }, {}, "/test");

		const [buildFlags] = mockExecuteBuildAll.mock.calls[0];
		expect(buildFlags.verbose).toBe(true);
		expect(buildFlags.transcript).toBe(true);
	});

	it("--iterations overrides config iterations in BuildFlags", async () => {
		const status = makeStatus();
		mockReadStatus.mockReturnValue(status);
		mockHasResumableSession.mockReturnValue(true);
		mockUpdateSessionState.mockReturnValue({ ...status, session: { ...status.session!, state: "active" } });

		await executeResume({ iterations: 10 }, {}, "/test");

		const [buildFlags] = mockExecuteBuildAll.mock.calls[0];
		expect(buildFlags.iterations).toBe(10);
	});
});

describe("Resume component", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockLoadConfig.mockReturnValue(defaultConfig as ReturnType<typeof loadConfig>);
		mockResolveCommandConfig.mockReturnValue(defaultCommandConfig);
		mockDiscoverSpecs.mockReturnValue([
			makeSpec("42-session-lifecycle"),
			makeSpec("43-resume-command"),
		]);
		mockFindSpec.mockImplementation((_specs, query) => {
			const map: Record<string, Spec> = {
				"42-session-lifecycle": makeSpec("42-session-lifecycle"),
				"43-resume-command": makeSpec("43-resume-command"),
			};
			return map[query];
		});
	});

	it("renders preview messages before building", async () => {
		const status = makeStatus();
		mockReadStatus.mockReturnValue(status);
		mockHasResumableSession.mockReturnValue(true);
		mockUpdateSessionState.mockReturnValue({ ...status, session: { ...status.session!, state: "active" } });

		mockExecuteBuildAll.mockImplementation(() => new Promise(() => {}));

		const { lastFrame } = render(<Resume />);

		await vi.waitFor(() => {
			const output = lastFrame()!;
			expect(output).toContain("Resuming");
		});
	});

	it("renders error when no session exists", async () => {
		mockReadStatus.mockReturnValue({ specs: {} });
		mockHasResumableSession.mockReturnValue(false);

		const { lastFrame } = render(<Resume />);

		await vi.waitFor(() => {
			const output = lastFrame()!;
			expect(output).toContain("No active session to resume");
		});
	});

	it("renders summary on completion", async () => {
		const status = makeStatus();
		mockReadStatus.mockReturnValue(status);
		mockHasResumableSession.mockReturnValue(true);
		mockUpdateSessionState.mockReturnValue({ ...status, session: { ...status.session!, state: "active" } });

		mockExecuteBuildAll.mockResolvedValue({
			built: [{
				specName: "43-resume-command",
				totalIterations: 3,
				maxIterations: 10,
				totalTokens: 1500,
				specDone: true,
				stopReason: "sentinel" as const,
				error: undefined,
			}],
		});

		const { lastFrame } = render(<Resume />);

		await vi.waitFor(() => {
			const output = lastFrame()!;
			expect(output).toContain("Resume complete");
			expect(output).toContain("43-resume-command");
			expect(output).toContain("3 iterations");
		});
	});

	it("shows max_iterations warning per spec in done summary", async () => {
		const status = makeStatus();
		mockReadStatus.mockReturnValue(status);
		mockHasResumableSession.mockReturnValue(true);
		mockUpdateSessionState.mockReturnValue({ ...status, session: { ...status.session!, state: "active" } });

		mockExecuteBuildAll.mockResolvedValue({
			built: [
				{
					specName: "01-auth",
					totalIterations: 10,
					maxIterations: 10,
					totalTokens: 5000,
					specDone: false,
					stopReason: "max_iterations" as const,
				},
				{
					specName: "02-api",
					totalIterations: 3,
					maxIterations: 10,
					totalTokens: 1500,
					specDone: true,
					stopReason: "sentinel" as const,
				},
			],
		});

		const { lastFrame } = render(<Resume />);

		await vi.waitFor(() => {
			const output = lastFrame()!;
			expect(output).toContain("⚠️");
			expect(output).toContain("max iteration limit reached");
			expect(output).toContain("10/10");
			expect(output).toContain("02-api: 3 iterations");
			expect(output).toContain("[done]");
		});
	});
});
