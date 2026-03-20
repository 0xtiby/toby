import { describe, it, expect, vi, beforeEach } from "vitest";
import { SENTINEL, containsSentinel, runLoop } from "./loop.js";
import type { LoopOptions } from "./loop.js";

vi.mock("@0xtiby/spawner", () => ({
	spawn: vi.fn(),
}));

import { spawn } from "@0xtiby/spawner";

const mockSpawn = vi.mocked(spawn);

function makeCliResult(overrides: Record<string, unknown> = {}) {
	return {
		exitCode: 0,
		sessionId: "sess-1",
		usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150, cost: 0.01 },
		model: "claude-sonnet-4-6",
		error: null,
		durationMs: 1000,
		...overrides,
	};
}

function makeMockProc(events: Array<{ type: string; content?: string; raw: string }>, result = makeCliResult()) {
	return {
		events: (async function* () {
			for (const e of events) {
				yield { ...e, timestamp: Date.now() } as never;
			}
		})(),
		pid: 123,
		interrupt: vi.fn(),
		done: Promise.resolve(result),
	};
}

function baseOptions(overrides: Partial<LoopOptions> = {}): LoopOptions {
	return {
		maxIterations: 3,
		getPrompt: (i) => `prompt ${i}`,
		cli: "claude",
		cwd: "/tmp",
		...overrides,
	};
}

describe("SENTINEL", () => {
	it("equals :::TOBY_DONE:::", () => {
		expect(SENTINEL).toBe(":::TOBY_DONE:::");
	});
});

describe("containsSentinel", () => {
	it("returns true for exact sentinel", () => {
		expect(containsSentinel(":::TOBY_DONE:::")).toBe(true);
	});

	it("returns true when sentinel is embedded in text", () => {
		expect(containsSentinel("abc:::TOBY_DONE:::def")).toBe(true);
	});

	it("returns false for non-matching text", () => {
		expect(containsSentinel("hello world")).toBe(false);
	});

	it("returns false for empty string", () => {
		expect(containsSentinel("")).toBe(false);
	});

	it("returns false for partial sentinel", () => {
		expect(containsSentinel(":::TOBY_DON")).toBe(false);
	});
});

describe("runLoop", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("runs maxIterations when no sentinel detected", async () => {
		mockSpawn.mockImplementation(() =>
			makeMockProc([{ type: "text", content: "working...", raw: "working..." }]),
		);

		const result = await runLoop(baseOptions({ maxIterations: 3 }));

		expect(result.stopReason).toBe("max_iterations");
		expect(result.iterations).toHaveLength(3);
		expect(mockSpawn).toHaveBeenCalledTimes(3);
	});

	it("stops on sentinel detection", async () => {
		let callCount = 0;
		mockSpawn.mockImplementation(() => {
			callCount++;
			if (callCount === 2) {
				return makeMockProc([{ type: "text", content: `done ${SENTINEL}`, raw: `done ${SENTINEL}` }]);
			}
			return makeMockProc([{ type: "text", content: "working...", raw: "working..." }]);
		});

		const result = await runLoop(baseOptions({ maxIterations: 5 }));

		expect(result.stopReason).toBe("sentinel");
		expect(result.iterations).toHaveLength(2);
		expect(result.iterations[1].sentinelDetected).toBe(true);
		expect(result.iterations[0].sentinelDetected).toBe(false);
	});

	it("omits model from spawn when model is 'default'", async () => {
		mockSpawn.mockImplementation(() => makeMockProc([]));

		await runLoop(baseOptions({ maxIterations: 1, model: "default" }));

		const spawnCall = mockSpawn.mock.calls[0][0];
		expect(spawnCall).not.toHaveProperty("model");
	});

	it("passes model to spawn when explicitly set", async () => {
		mockSpawn.mockImplementation(() => makeMockProc([]));

		await runLoop(baseOptions({ maxIterations: 1, model: "claude-opus-4-6" }));

		const spawnCall = mockSpawn.mock.calls[0][0];
		expect(spawnCall.model).toBe("claude-opus-4-6");
	});

	it("returns empty results for zero iterations", async () => {
		const result = await runLoop(baseOptions({ maxIterations: 0 }));

		expect(result.stopReason).toBe("max_iterations");
		expect(result.iterations).toHaveLength(0);
		expect(mockSpawn).not.toHaveBeenCalled();
	});

	it("calls onEvent for each event", async () => {
		const events = [
			{ type: "text", content: "hello", raw: "hello" },
			{ type: "text", content: "world", raw: "world" },
		];
		mockSpawn.mockImplementation(() => makeMockProc(events));
		const onEvent = vi.fn();

		await runLoop(baseOptions({ maxIterations: 1, onEvent }));

		expect(onEvent).toHaveBeenCalledTimes(2);
	});

	it("calls onIterationComplete after each iteration", async () => {
		mockSpawn.mockImplementation(() => makeMockProc([]));
		const onIterationComplete = vi.fn();

		await runLoop(baseOptions({ maxIterations: 2, onIterationComplete }));

		expect(onIterationComplete).toHaveBeenCalledTimes(2);
		expect(onIterationComplete.mock.calls[0][0].iteration).toBe(1);
		expect(onIterationComplete.mock.calls[1][0].iteration).toBe(2);
	});

	it("populates IterationResult fields from CliResult", async () => {
		const cliResult = makeCliResult({
			sessionId: "abc-123",
			exitCode: 0,
			model: "claude-opus-4-6",
			durationMs: 2500,
		});
		mockSpawn.mockImplementation(() => makeMockProc([], cliResult));

		const result = await runLoop(baseOptions({ maxIterations: 1 }));

		const iter = result.iterations[0];
		expect(iter.sessionId).toBe("abc-123");
		expect(iter.exitCode).toBe(0);
		expect(iter.tokensUsed).toBe(150);
		expect(iter.model).toBe("claude-opus-4-6");
		expect(iter.durationMs).toBe(2500);
	});

	it("calls getPrompt with iteration number", async () => {
		mockSpawn.mockImplementation(() => makeMockProc([]));
		const getPrompt = vi.fn((i: number) => `prompt-${i}`);

		await runLoop(baseOptions({ maxIterations: 2, getPrompt }));

		expect(getPrompt).toHaveBeenCalledWith(1);
		expect(getPrompt).toHaveBeenCalledWith(2);
	});

	it("passes autoApprove to spawner", async () => {
		mockSpawn.mockImplementation(() => makeMockProc([]));

		await runLoop(baseOptions({ maxIterations: 1 }));

		expect(mockSpawn.mock.calls[0][0].autoApprove).toBe(true);
	});

	describe("session continuity", () => {
		it("passes sessionId from iteration 1 to iteration 2 when continueSession is true", async () => {
			let callCount = 0;
			mockSpawn.mockImplementation(() => {
				callCount++;
				return makeMockProc([], makeCliResult({ sessionId: callCount === 1 ? "abc" : "def" }));
			});

			await runLoop(baseOptions({ maxIterations: 2, continueSession: true }));

			// Iteration 1: no sessionId (fresh)
			expect(mockSpawn.mock.calls[0][0]).not.toHaveProperty("sessionId");
			// Iteration 2: sessionId from iter 1
			expect(mockSpawn.mock.calls[1][0].sessionId).toBe("abc");
			expect(mockSpawn.mock.calls[1][0].continueSession).toBe(true);
		});

		it("does not pass sessionId between iterations when continueSession is false", async () => {
			mockSpawn.mockImplementation(() =>
				makeMockProc([], makeCliResult({ sessionId: "abc" })),
			);

			await runLoop(baseOptions({ maxIterations: 2, continueSession: false }));

			// Neither call should have sessionId
			expect(mockSpawn.mock.calls[0][0]).not.toHaveProperty("sessionId");
			expect(mockSpawn.mock.calls[1][0]).not.toHaveProperty("sessionId");
		});

		it("defaults continueSession to false (no propagation)", async () => {
			mockSpawn.mockImplementation(() =>
				makeMockProc([], makeCliResult({ sessionId: "abc" })),
			);

			await runLoop(baseOptions({ maxIterations: 2 }));

			expect(mockSpawn.mock.calls[1][0]).not.toHaveProperty("sessionId");
		});

		it("spawns without sessionId when previous result has null sessionId", async () => {
			let callCount = 0;
			mockSpawn.mockImplementation(() => {
				callCount++;
				return makeMockProc([], makeCliResult({ sessionId: callCount === 1 ? null : "xyz" }));
			});

			await runLoop(baseOptions({ maxIterations: 2, continueSession: true }));

			// Iteration 2: no sessionId since iter 1 returned null
			expect(mockSpawn.mock.calls[1][0]).not.toHaveProperty("sessionId");
		});

		it("uses initial sessionId and continues from returned sessionId", async () => {
			let callCount = 0;
			mockSpawn.mockImplementation(() => {
				callCount++;
				return makeMockProc([], makeCliResult({ sessionId: callCount === 1 ? "new-session" : "newer" }));
			});

			await runLoop(baseOptions({ maxIterations: 2, continueSession: true, sessionId: "initial" }));

			// Iteration 1: uses provided initial sessionId
			expect(mockSpawn.mock.calls[0][0].sessionId).toBe("initial");
			// Iteration 2: uses sessionId from iter 1
			expect(mockSpawn.mock.calls[1][0].sessionId).toBe("new-session");
		});

		it("always uses initial sessionId when continueSession is false", async () => {
			mockSpawn.mockImplementation(() =>
				makeMockProc([], makeCliResult({ sessionId: "new-session" })),
			);

			await runLoop(baseOptions({ maxIterations: 2, continueSession: false, sessionId: "initial" }));

			// Both calls use the initial sessionId (not propagated)
			expect(mockSpawn.mock.calls[0][0].sessionId).toBe("initial");
			expect(mockSpawn.mock.calls[1][0].sessionId).toBe("initial");
		});
	});
});
