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
	stopReason: "sentinel" | "max_iterations";
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
	} = options;

	const results: IterationResult[] = [];

	if (maxIterations <= 0) {
		return { iterations: results, stopReason: "max_iterations" };
	}

	let lastSessionId: string | undefined = options.sessionId ?? undefined;

	for (let i = 1; i <= maxIterations; i++) {
		const prompt = getPrompt(i);

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

		let sentinelDetected = false;
		for await (const event of proc.events) {
			onEvent?.(event);
			if (event.type === "text" && event.content && containsSentinel(event.content)) {
				sentinelDetected = true;
			}
		}

		const cliResult = await proc.done;

		const iterResult: IterationResult = {
			iteration: i,
			sessionId: cliResult.sessionId,
			exitCode: cliResult.exitCode,
			tokensUsed: cliResult.usage?.totalTokens ?? null,
			model: cliResult.model,
			durationMs: cliResult.durationMs,
			sentinelDetected,
		};

		results.push(iterResult);
		onIterationComplete?.(iterResult);

		if (sentinelDetected) {
			return { iterations: results, stopReason: "sentinel" };
		}

		if (continueSession) {
			lastSessionId = cliResult.sessionId ?? lastSessionId;
		}
	}

	return { iterations: results, stopReason: "max_iterations" };
}
