import fs from "node:fs";
import chalk from "chalk";
import { loadConfig, validateCliName } from "../lib/config.js";
import { resolveSyncPromptPath, substitute, resolveTemplateVars } from "../lib/template.js";
import { runLoop } from "../lib/loop.js";
import { costSuffix, formatTokens } from "../ui/format.js";
import { writeEvent } from "../ui/stream.js";
import { withSigint } from "../ui/signal.js";
import type { CliName, TemplateVars } from "../types.js";

export interface SyncFlags {
	cli?: string;
	model?: string;
	verbose?: boolean;
}

export interface SyncResult {
	totalTokens: number;
	totalCost: number;
	stopReason: string;
}

/**
 * Core sync logic, separated from CLI wrapper for testability.
 */
export async function executeSync(
	flags: SyncFlags = {},
	cwd: string = process.cwd(),
	abortSignal?: AbortSignal,
): Promise<SyncResult> {
	const config = loadConfig(cwd);

	// Resolve CLI and model: flags → sync config → plan config
	validateCliName(flags.cli);
	const cli = (flags.cli ?? config.sync?.cli ?? config.plan.cli) as CliName;
	const model = flags.model ?? config.sync?.model ?? config.plan.model ?? "default";
	const verbose = flags.verbose ?? config.verbose ?? false;

	// Check that sync prompt exists (throws with guidance if missing)
	const promptPath = resolveSyncPromptPath(cwd);
	const promptContent = fs.readFileSync(promptPath, "utf-8");

	// Build template vars — sync only needs SPECS_DIR
	const cliVars: TemplateVars = { SPECS_DIR: config.specsDir };
	const vars = resolveTemplateVars(cliVars, config.templateVars, verbose);
	const prompt = substitute(promptContent, vars);

	const loopResult = await runLoop({
		maxIterations: 1,
		getPrompt: () => prompt,
		cli,
		model,
		cwd,
		abortSignal,
		onEvent: (event) => writeEvent(event, verbose),
	});

	const totalTokens = loopResult.iterations.reduce((sum, r) => sum + (r.tokensUsed ?? 0), 0);
	const totalCost = loopResult.iterations.reduce((sum, r) => sum + (r.cost ?? 0), 0);

	return {
		totalTokens,
		totalCost,
		stopReason: loopResult.stopReason,
	};
}

/**
 * CLI wrapper for sync command.
 */
export async function runSync(opts: SyncFlags): Promise<void> {
	const result = await withSigint((signal) =>
		executeSync(opts, process.cwd(), signal),
	);

	if (result.stopReason === "aborted") {
		console.log(chalk.yellow("⚠ Sync interrupted"));
	} else if (result.stopReason === "error") {
		console.log(chalk.red("✗ Sync failed"));
		process.exitCode = 1;
	} else {
		console.log(
			chalk.green(
				`✔ Sync complete (${formatTokens(result.totalTokens)} tokens${costSuffix(result.totalCost)})`,
			),
		);
	}
}
