import { spawn } from "@0xtiby/spawner";
import type { CliEvent, SpawnOptions } from "@0xtiby/spawner";

export const SENTINEL = ":::TOBY_DONE:::";

export function containsSentinel(text: string): boolean {
	return text.includes(SENTINEL);
}

export interface LoopOptions {
	maxIterations: number;
	getPrompt: (iteration: number) => string;
	cli: "claude" | "codex" | "opencode";
	model?: string;
	cwd: string;
	autoApprove?: boolean;
	sessionId?: string;
	continueSession?: boolean;
	onEvent?: (event: CliEvent) => void;
	onIterationComplete?: (result: IterationResult) => void;
	abortSignal?: AbortSignal;
}

export interface IterationResult {
	iteration: number;
	sessionId: string | null;
	exitCode: number;
	tokensUsed: number | null;
	model: string | null;
	durationMs: number;
	sentinelDetected: boolean;
}

export interface LoopResult {
	iterations: IterationResult[];
	stopReason: "sentinel" | "max_iterations" | "error" | "aborted";
}

/**
 * Run the iteration loop: spawn AI CLI, detect sentinel, repeat.
 */
export async function runLoop(options: LoopOptions): Promise<LoopResult> {
	const {
		maxIterations,
		getPrompt,
		cli,
		model,
		cwd,
		autoApprove = true,
		continueSession = false,
		onEvent,
		onIterationComplete,
		abortSignal,
	} = options;

	const results: IterationResult[] = [];

	if (abortSignal?.aborted) {
		return { iterations: results, stopReason: "aborted" };
	}

	if (maxIterations <= 0) {
		return { iterations: results, stopReason: "max_iterations" };
	}

	let lastSessionId: string | undefined = options.sessionId ?? undefined;
	let iteration = 1;

	while (iteration <= maxIterations) {
		const prompt = getPrompt(iteration);

		const effectiveSessionId = continueSession ? lastSessionId : options.sessionId;

		const spawnOpts: SpawnOptions = {
			cli,
			prompt,
			cwd,
			autoApprove,
			...(model && model !== "default" ? { model } : {}),
			...(effectiveSessionId ? { sessionId: effectiveSessionId, continueSession: true } : {}),
		};

		const proc = spawn(spawnOpts);

		let aborted = false;
		const onAbort = () => {
			aborted = true;
			proc.interrupt();
		};
		abortSignal?.addEventListener("abort", onAbort, { once: true });

		let sentinelDetected = false;
		for await (const event of proc.events) {
			onEvent?.(event);
			if (event.type === "text" && event.content && containsSentinel(event.content)) {
				sentinelDetected = true;
			}
		}

		const cliResult = await proc.done;
		abortSignal?.removeEventListener("abort", onAbort);

		const iterResult: IterationResult = {
			iteration,
			sessionId: cliResult.sessionId,
			exitCode: cliResult.exitCode,
			tokensUsed: cliResult.usage?.totalTokens ?? null,
			model: cliResult.model,
			durationMs: cliResult.durationMs,
			sentinelDetected,
		};

		results.push(iterResult);
		onIterationComplete?.(iterResult);

		if (aborted) {
			return { iterations: results, stopReason: "aborted" };
		}

		if (sentinelDetected) {
			return { iterations: results, stopReason: "sentinel" };
		}

		if (cliResult.exitCode !== 0) {
			if (cliResult.error?.retryable) {
				const delay = cliResult.error.retryAfterMs ?? 60_000;
				await new Promise((r) => setTimeout(r, delay));
				continue; // retry same iteration
			}
			return { iterations: results, stopReason: "error" };
		}

		if (continueSession) {
			lastSessionId = cliResult.sessionId ?? lastSessionId;
		}

		iteration++;
	}

	return { iterations: results, stopReason: "max_iterations" };
}
