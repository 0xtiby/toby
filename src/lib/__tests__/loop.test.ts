import { describe, it, expect, vi, beforeEach } from "vitest";
import { SENTINEL, runLoop } from "../loop.js";
import type { LoopOptions, IterationResult } from "../loop.js";

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

describe("runLoop integration", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("maxIterations=3, no sentinel → stopReason 'max_iterations', 3 iterations", async () => {
		mockSpawn.mockImplementation(() =>
			makeMockProc([{ type: "text", content: "working", raw: "working" }]),
		);

		const result = await runLoop(baseOptions({ maxIterations: 3 }));

		expect(result.stopReason).toBe("max_iterations");
		expect(result.iterations).toHaveLength(3);
		expect(result.iterations.map((i) => i.iteration)).toEqual([1, 2, 3]);
	});

	it("sentinel on iter 2 → stopReason 'sentinel', 2 iterations", async () => {
		let callCount = 0;
		mockSpawn.mockImplementation(() => {
			callCount++;
			if (callCount === 2) {
				return makeMockProc([{ type: "text", content: `done ${SENTINEL}`, raw: `done ${SENTINEL}` }]);
			}
			return makeMockProc([{ type: "text", content: "working", raw: "working" }]);
		});

		const result = await runLoop(baseOptions({ maxIterations: 5 }));

		expect(result.stopReason).toBe("sentinel");
		expect(result.iterations).toHaveLength(2);
		expect(result.iterations[1].sentinelDetected).toBe(true);
		expect(result.iterations[0].sentinelDetected).toBe(false);
	});

	it("retryable error → retries same iteration", async () => {
		let callCount = 0;
		mockSpawn.mockImplementation(() => {
			callCount++;
			if (callCount === 1) {
				return makeMockProc(
					[{ type: "text", content: "rate limited", raw: "rate limited" }],
					makeCliResult({
						exitCode: 1,
						error: { code: "rate_limit", retryable: true, retryAfterMs: 10, matchedLine: "" },
					}),
				);
			}
			return makeMockProc([{ type: "text", content: "ok", raw: "ok" }]);
		});

		const result = await runLoop(baseOptions({ maxIterations: 3 }));

		expect(result.stopReason).toBe("max_iterations");
		// 4 calls: iter 1 fails, iter 1 retries, iter 2, iter 3
		expect(mockSpawn).toHaveBeenCalledTimes(4);
		// Both iteration 1 results recorded (failed + retried)
		expect(result.iterations[0].iteration).toBe(1);
		expect(result.iterations[0].exitCode).toBe(1);
		expect(result.iterations[1].iteration).toBe(1);
		expect(result.iterations[1].exitCode).toBe(0);
	});

	it("fatal error → stopReason 'error'", async () => {
		let callCount = 0;
		mockSpawn.mockImplementation(() => {
			callCount++;
			if (callCount === 2) {
				return makeMockProc(
					[],
					makeCliResult({
						exitCode: 1,
						error: { code: "auth", retryable: false, retryAfterMs: null, matchedLine: "" },
					}),
				);
			}
			return makeMockProc([{ type: "text", content: "ok", raw: "ok" }]);
		});

		const result = await runLoop(baseOptions({ maxIterations: 5 }));

		expect(result.stopReason).toBe("error");
		expect(result.iterations).toHaveLength(2);
		expect(result.iterations[1].exitCode).toBe(1);
	});

	it("model 'default' omitted from spawn options", async () => {
		mockSpawn.mockImplementation(() => makeMockProc([]));

		await runLoop(baseOptions({ maxIterations: 1, model: "default" }));

		expect(mockSpawn.mock.calls[0][0]).not.toHaveProperty("model");
	});

	it("model 'claude-opus-4-6' passed to spawn options", async () => {
		mockSpawn.mockImplementation(() => makeMockProc([]));

		await runLoop(baseOptions({ maxIterations: 1, model: "claude-opus-4-6" }));

		expect(mockSpawn.mock.calls[0][0].model).toBe("claude-opus-4-6");
	});

	it("continueSession passes sessionId between iters", async () => {
		let callCount = 0;
		mockSpawn.mockImplementation(() => {
			callCount++;
			return makeMockProc([], makeCliResult({ sessionId: `sess-${callCount}` }));
		});

		await runLoop(baseOptions({ maxIterations: 3, continueSession: true }));

		// Iteration 1: no sessionId (fresh)
		expect(mockSpawn.mock.calls[0][0]).not.toHaveProperty("sessionId");
		// Iteration 2: sessionId from iter 1
		expect(mockSpawn.mock.calls[1][0].sessionId).toBe("sess-1");
		expect(mockSpawn.mock.calls[1][0].continueSession).toBe(true);
		// Iteration 3: sessionId from iter 2
		expect(mockSpawn.mock.calls[2][0].sessionId).toBe("sess-2");
	});

	it("abort mid-iteration → stopReason 'aborted'", async () => {
		const controller = new AbortController();
		let callCount = 0;

		mockSpawn.mockImplementation(() => {
			callCount++;
			if (callCount === 2) {
				const interruptFn = vi.fn();
				return {
					events: (async function* () {
						yield { type: "text", content: "working", raw: "working", timestamp: Date.now() } as never;
						controller.abort();
					})(),
					pid: 123,
					interrupt: interruptFn,
					done: Promise.resolve(makeCliResult()),
				};
			}
			return makeMockProc([{ type: "text", content: "ok", raw: "ok" }]);
		});

		const result = await runLoop(baseOptions({ maxIterations: 5, abortSignal: controller.signal }));

		expect(result.stopReason).toBe("aborted");
		expect(result.iterations).toHaveLength(2);
	});

	it("zero iterations → empty result", async () => {
		const result = await runLoop(baseOptions({ maxIterations: 0 }));

		expect(result.stopReason).toBe("max_iterations");
		expect(result.iterations).toHaveLength(0);
		expect(mockSpawn).not.toHaveBeenCalled();
	});

	it("onEvent callback receives streamed events", async () => {
		const events = [
			{ type: "text", content: "hello", raw: "hello" },
			{ type: "text", content: "world", raw: "world" },
			{ type: "tool_use", raw: "tool call" },
		];
		mockSpawn.mockImplementation(() => makeMockProc(events));

		const received: unknown[] = [];
		await runLoop(baseOptions({ maxIterations: 1, onEvent: (e) => received.push(e) }));

		expect(received).toHaveLength(3);
		expect(received[0]).toMatchObject({ type: "text", content: "hello" });
		expect(received[1]).toMatchObject({ type: "text", content: "world" });
		expect(received[2]).toMatchObject({ type: "tool_use" });
	});

	it("onIterationStart called before spawn for each iteration", async () => {
		const callOrder: string[] = [];
		mockSpawn.mockImplementation(() => {
			callOrder.push("spawn");
			return makeMockProc([{ type: "text", content: "ok", raw: "ok" }]);
		});

		const startCalls: Array<{ iteration: number; sessionId: string | null }> = [];
		await runLoop(baseOptions({
			maxIterations: 2,
			onIterationStart: (iteration, sessionId) => {
				callOrder.push("onIterationStart");
				startCalls.push({ iteration, sessionId });
			},
		}));

		expect(startCalls).toHaveLength(2);
		expect(startCalls[0].iteration).toBe(1);
		expect(startCalls[1].iteration).toBe(2);
		// Verify onIterationStart is called before spawn
		expect(callOrder.filter((c) => c === "onIterationStart").length).toBe(2);
		expect(callOrder[0]).toBe("onIterationStart");
		expect(callOrder[1]).toBe("spawn");
	});

	it("onIterationStart receives sessionId when provided", async () => {
		mockSpawn.mockImplementation(() =>
			makeMockProc([{ type: "text", content: "ok", raw: "ok" }]),
		);

		const startCalls: Array<{ iteration: number; sessionId: string | null }> = [];
		await runLoop(baseOptions({
			maxIterations: 1,
			sessionId: "my-session",
			onIterationStart: (iteration, sessionId) => {
				startCalls.push({ iteration, sessionId });
			},
		}));

		expect(startCalls[0].sessionId).toBe("my-session");
	});

	it("onIterationStart receives null sessionId when none provided", async () => {
		mockSpawn.mockImplementation(() =>
			makeMockProc([{ type: "text", content: "ok", raw: "ok" }]),
		);

		const startCalls: Array<{ iteration: number; sessionId: string | null }> = [];
		await runLoop(baseOptions({
			maxIterations: 1,
			onIterationStart: (iteration, sessionId) => {
				startCalls.push({ iteration, sessionId });
			},
		}));

		expect(startCalls[0].sessionId).toBeNull();
	});

	it("loop works without onIterationStart (backward compat)", async () => {
		mockSpawn.mockImplementation(() =>
			makeMockProc([{ type: "text", content: "ok", raw: "ok" }]),
		);

		const result = await runLoop(baseOptions({ maxIterations: 2 }));

		expect(result.stopReason).toBe("max_iterations");
		expect(result.iterations).toHaveLength(2);
	});

	it("onIterationComplete receives IterationResult", async () => {
		mockSpawn.mockImplementation(() =>
			makeMockProc(
				[{ type: "text", content: "work", raw: "work" }],
				makeCliResult({ sessionId: "s1", model: "claude-opus-4-6", durationMs: 2500 }),
			),
		);

		const results: IterationResult[] = [];
		await runLoop(baseOptions({ maxIterations: 2, onIterationComplete: (r) => results.push(r) }));

		expect(results).toHaveLength(2);
		expect(results[0]).toMatchObject({
			iteration: 1,
			sessionId: "s1",
			exitCode: 0,
			tokensUsed: 150,
			inputTokens: 100,
			outputTokens: 50,
			cost: 0.01,
			model: "claude-opus-4-6",
			durationMs: 2500,
			sentinelDetected: false,
		});
		expect(results[1].iteration).toBe(2);
	});

	it("usage fields default to null when not provided by spawner", async () => {
		mockSpawn.mockImplementation(() =>
			makeMockProc(
				[],
				makeCliResult({ usage: undefined }),
			),
		);

		const results: IterationResult[] = [];
		await runLoop(baseOptions({ maxIterations: 1, onIterationComplete: (r) => results.push(r) }));

		expect(results[0].tokensUsed).toBeNull();
		expect(results[0].inputTokens).toBeNull();
		expect(results[0].outputTokens).toBeNull();
		expect(results[0].cost).toBeNull();
	});
});
