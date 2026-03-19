import type { TobyConfig } from "../types.js";

export interface LoopOptions {
	config: TobyConfig;
	specName: string;
	command: "plan" | "build";
	prompt: string;
}

export interface LoopResult {
	iterations: number;
	completed: boolean;
}

/**
 * Run the iteration loop: spawn AI CLI, detect sentinel, repeat.
 */
export function runLoop(_options: LoopOptions): Promise<LoopResult> {
	throw new Error("runLoop: not implemented");
}
