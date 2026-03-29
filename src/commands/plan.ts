import chalk from "chalk";
import type { CliEvent } from "@0xtiby/spawner";
import { loadConfig, resolveCommandConfig } from "../lib/config.js";
import { discoverSpecs, filterByStatus, findSpec, findSpecs } from "../lib/specs.js";
import type { Spec } from "../lib/specs.js";
import { loadPrompt, computeCliVars, resolveTemplateVars, computeSpecSlug, generateSessionName } from "../lib/template.js";
import { runLoop } from "../lib/loop.js";
import type { IterationResult } from "../lib/loop.js";
import {
	readStatus,
	writeStatus,
	addIteration,
	updateSpecStatus,
} from "../lib/status.js";
import { ensureLocalDir } from "../lib/paths.js";
import type { CommandFlags, Iteration, StopReason } from "../types.js";
import { formatMaxIterationsWarning } from "../lib/format.js";
import { costSuffix, sumResults, formatTokens } from "../ui/format.js";
import { AbortError } from "../lib/errors.js";
import { withTranscript } from "../lib/transcript.js";
import type { TranscriptWriter } from "../lib/transcript.js";
import { writeEvent } from "../ui/stream.js";
import { isTTY } from "../ui/tty.js";
import { selectSpecs } from "../ui/prompt.js";
import { withSigint } from "../ui/signal.js";

export type PlanFlags = CommandFlags;

export interface PlanCallbacks {
	onPhase?: (phase: string) => void;
	onIteration?: (current: number, max: number) => void;
	onEvent?: (event: CliEvent) => void;
	onRefinement?: (specName: string) => void;
}

export interface PlanResult {
	specName: string;
	totalIterations: number;
	maxIterations: number;
	totalTokens: number;
	totalCost: number;
	stopReason: StopReason;
}

/**
 * Core planning logic, separated from Ink rendering for testability.
 */
export async function executePlan(
	flags: PlanFlags,
	callbacks: PlanCallbacks = {},
	cwd: string = process.cwd(),
	abortSignal?: AbortSignal,
	externalWriter?: TranscriptWriter | null,
): Promise<PlanResult> {
	ensureLocalDir(cwd);

	const config = loadConfig(cwd);
	const commandConfig = resolveCommandConfig(config, "plan", {
		cli: flags.cli as "claude" | "codex" | "opencode" | undefined,
		iterations: flags.iterations,
	});

	if (!flags.spec) {
		throw new Error("No --spec flag provided. Usage: toby plan --spec=<name>");
	}

	const specs = discoverSpecs(cwd, config);
	if (specs.length === 0) {
		throw new Error("No specs found in specs/");
	}

	const found = findSpec(specs, flags.spec);
	if (!found) {
		throw new Error(`Spec '${flags.spec}' not found`);
	}

	// Detect refinement mode: status 'planned' means we're refining
	let status = readStatus(cwd);
	const specEntry = status.specs[found.name];
	const existingIterations = specEntry?.iterations.length ?? 0;
	const isRefinement = specEntry?.status === "planned";

	if (isRefinement) {
		callbacks.onRefinement?.(found.name);
	}

	const session = flags.session || computeSpecSlug(found.name);

	return withTranscript(
		{ flags, config, command: "plan", specName: found.name },
		externalWriter,
		async (writer) => {
			let iterationStartTime = new Date().toISOString();
			callbacks.onPhase?.("planning");
			callbacks.onIteration?.(1, commandConfig.iterations);

			const loopResult = await runLoop({
				maxIterations: commandConfig.iterations,
				getPrompt: (iteration) => {
					const cliVars = computeCliVars({
						specName: found.name,
						iteration: iteration + existingIterations,
						specIndex: 1,
						specCount: 1,
						session,
						specs: [found.name],
						specsDir: config.specsDir,
					});
					const vars = resolveTemplateVars(cliVars, config.templateVars);
					return loadPrompt("PROMPT_PLAN", vars, { cwd });
				},
				cli: commandConfig.cli,
				model: commandConfig.model,
				cwd,
				continueSession: true,
				abortSignal,
				onEvent: (event) => {
					writer?.writeEvent(event);
					callbacks.onEvent?.(event);
				},
				onIterationComplete: (iterResult: IterationResult) => {
					writer?.writeIterationHeader({
						iteration: iterResult.iteration,
						total: commandConfig.iterations,
						cli: commandConfig.cli,
						model: iterResult.model ?? commandConfig.model,
					});
					const completedAt = new Date().toISOString();
					const iteration: Iteration = {
						type: "plan",
						iteration: iterResult.iteration,
						sessionId: iterResult.sessionId,
						cli: commandConfig.cli,
						model: iterResult.model ?? commandConfig.model,
						startedAt: iterationStartTime,
						completedAt,
						exitCode: iterResult.exitCode,
						taskCompleted: null,
						tokensUsed: iterResult.tokensUsed,
						inputTokens: iterResult.inputTokens,
						outputTokens: iterResult.outputTokens,
						cost: iterResult.cost,
					};
					iterationStartTime = new Date().toISOString();
					status = addIteration(status, found.name, iteration);
					writeStatus(status, cwd);
					callbacks.onIteration?.(iterResult.iteration + 1, commandConfig.iterations);
				},
			});

			if (loopResult.stopReason === "aborted") {
				status = updateSpecStatus(status, found.name, "planned");
				writeStatus(status, cwd);
				throw new AbortError(found.name, loopResult.iterations.length);
			}

			status = updateSpecStatus(status, found.name, "planned");
			writeStatus(status, cwd);

			const totalTokens = loopResult.iterations.reduce((sum, r) => sum + (r.tokensUsed ?? 0), 0);
			const totalCost = loopResult.iterations.reduce((sum, r) => sum + (r.cost ?? 0), 0);

			return {
				specName: found.name,
				totalIterations: loopResult.iterations.length,
				maxIterations: commandConfig.iterations,
				totalTokens,
				totalCost,
				stopReason: loopResult.stopReason,
			};
		},
	);
}

export interface PlanAllCallbacks {
	onSpecStart?: (specName: string, index: number, total: number) => void;
	onSpecComplete?: (result: PlanResult) => void;
	onPhase?: (phase: string) => void;
	onIteration?: (current: number, max: number) => void;
	onEvent?: (event: CliEvent) => void;
	onRefinement?: (specName: string) => void;
}

export interface PlanAllResult {
	planned: PlanResult[];
}

/**
 * Plan all pending specs in NN- order.
 * Stops on first failure.
 */
export async function executePlanAll(
	flags: PlanFlags,
	callbacks: PlanAllCallbacks = {},
	cwd: string = process.cwd(),
	abortSignal?: AbortSignal,
	specs?: Spec[],
): Promise<PlanAllResult> {
	ensureLocalDir(cwd);

	const config = loadConfig(cwd);
	let pending: Spec[];

	if (specs) {
		// Pre-resolved specs (from multi-spec mode) — use directly
		pending = specs;
	} else {
		// Discovery mode — find and filter pending specs
		const discovered = discoverSpecs(cwd, config);

		if (discovered.length === 0) {
			throw new Error("No specs found in specs/");
		}

		pending = filterByStatus(discovered, "pending");
	}

	const planned: PlanResult[] = [];
	const session = flags.session || generateSessionName();

	return withTranscript(
		{ flags, config, command: "plan" },
		undefined,
		async (writer) => {
			for (let i = 0; i < pending.length; i++) {
				const spec = pending[i];
				writer?.writeSpecHeader(i + 1, pending.length, spec.name);
				callbacks.onSpecStart?.(spec.name, i, pending.length);

				const result = await executePlan(
					{ ...flags, spec: spec.name, all: false, session },
					{
						onPhase: callbacks.onPhase,
						onIteration: callbacks.onIteration,
						onEvent: callbacks.onEvent,
						onRefinement: callbacks.onRefinement,
					},
					cwd,
					abortSignal,
					writer,
				);

				planned.push(result);
				callbacks.onSpecComplete?.(result);
			}

			return { planned };
		},
	);
}

export interface RunPlanOptions {
	spec?: string;
	all?: boolean;
	verbose?: boolean;
	transcript?: boolean;
	iterations?: number;
	cli?: string;
	session?: string;
}

function printSummary(result: PlanResult): void {
	if (result.stopReason === "max_iterations") {
		console.log(chalk.yellow(`⚠️ Spec "${result.specName}": ${formatMaxIterationsWarning(result.totalIterations, result.maxIterations)}`));
	} else {
		console.log(chalk.green(`✔ Plan complete for ${result.specName} (${result.totalIterations} iterations, ${formatTokens(result.totalTokens)} tokens${costSuffix(result.totalCost)})`));
	}
}

function printAllSummary(result: PlanAllResult): void {
	const hasWarnings = result.planned.some((r) => r.stopReason === "max_iterations");
	console.log(
		hasWarnings
			? chalk.yellow(`⚠️ All specs planned (${result.planned.length} planned)`)
			: chalk.green(`✔ All specs planned (${result.planned.length} planned)`),
	);
	for (const r of result.planned) {
		if (r.stopReason === "max_iterations") {
			console.log(chalk.yellow(`  ⚠️ ${r.specName}: ${formatMaxIterationsWarning(r.totalIterations, r.maxIterations)}`));
		} else {
			console.log(`  ✔ ${r.specName} planned (${r.totalIterations} iterations, ${formatTokens(r.totalTokens)} tokens${costSuffix(r.totalCost)})`);
		}
	}
	const { totalIter, totalTok, totalCost: tc } = sumResults(result.planned);
	console.log(chalk.dim(`  Total: ${totalIter} iterations, ${formatTokens(totalTok)} tokens${costSuffix(tc)}`));
}

function printInterrupted(specName: string, completedIterations: number): void {
	console.log(chalk.yellow(`⚠ Planning interrupted for ${specName}`));
	console.log(chalk.dim(`  ${completedIterations} iteration(s) completed, partial status saved`));
}

function makePlanAllCallbacks(verbose: boolean): PlanAllCallbacks {
	return {
		onEvent: (event) => writeEvent(event, verbose),
		onSpecStart: (name, i, total) => {
			console.log(chalk.dim(`◇ Planning ${name} (${i + 1}/${total})`));
		},
		onSpecComplete: (result) => {
			if (result.stopReason === "max_iterations") {
				console.log(chalk.yellow(`⚠️ ${result.specName}: ${formatMaxIterationsWarning(result.totalIterations, result.maxIterations)}`));
			} else {
				console.log(chalk.green(`✔ ${result.specName} planned (${result.totalIterations} iterations, ${formatTokens(result.totalTokens)} tokens${costSuffix(result.totalCost)})`));
			}
		},
		onRefinement: (specName) => {
			console.log(chalk.yellow(`Existing plan found for ${specName}`));
			console.log(chalk.yellow("Running in refinement mode..."));
		},
	};
}

/**
 * Imperative CLI wrapper for plan command.
 */
export async function runPlan(opts: RunPlanOptions): Promise<void> {
	const cwd = process.cwd();
	const config = loadConfig(cwd);
	const verbose = opts.verbose ?? config.verbose ?? false;

	const flags: PlanFlags = {
		spec: opts.spec,
		all: opts.all ?? false,
		verbose,
		transcript: opts.transcript,
		iterations: opts.iterations,
		cli: opts.cli,
		session: opts.session,
	};

	if (flags.all) {
		const discovered = discoverSpecs(cwd, config);
		if (discovered.length === 0) {
			console.log("No specs found.");
			return;
		}

		const pending = filterByStatus(discovered, "pending");
		if (pending.length === 0) {
			console.log("All specs have been planned.");
			return;
		}

		try {
			const result = await withSigint((signal) =>
				executePlanAll(flags, makePlanAllCallbacks(verbose), cwd, signal, pending),
			);
			printAllSummary(result);
		} catch (err) {
			if (err instanceof AbortError) {
				printInterrupted(err.specName, err.completedIterations);
			} else {
				throw err;
			}
		}
		return;
	}

	if (flags.spec) {
		const discovered = discoverSpecs(cwd, config);
		if (discovered.length === 0) {
			console.log("No specs found.");
			return;
		}

		// Comma-separated → multiple specs
		if (flags.spec.includes(",")) {
			let resolved: ReturnType<typeof findSpecs>;
			try {
				resolved = findSpecs(discovered, flags.spec);
			} catch (err) {
				const available = discovered.map((s) => s.name).join(", ");
				console.error(chalk.red(`${(err as Error).message}. Available: ${available}`));
				process.exitCode = 1;
				return;
			}

			try {
				const result = await withSigint((signal) =>
					executePlanAll(flags, makePlanAllCallbacks(verbose), cwd, signal, resolved),
				);
				printAllSummary(result);
			} catch (err) {
				if (err instanceof AbortError) {
					printInterrupted(err.specName, err.completedIterations);
				} else {
					throw err;
				}
			}
			return;
		}

		// Single spec
		const found = findSpec(discovered, flags.spec);
		if (!found) {
			const available = discovered.map((s) => s.name).join(", ");
			console.error(chalk.red(`Spec '${flags.spec}' not found. Available: ${available}`));
			process.exitCode = 1;
			return;
		}

		const callbacks: PlanCallbacks = {
			onEvent: (event) => writeEvent(event, verbose),
			onIteration: (current, max) => {
				console.log(chalk.dim(`  Iteration ${current}/${max}`));
			},
			onRefinement: (specName) => {
				console.log(chalk.yellow(`Existing plan found for ${specName}`));
				console.log(chalk.yellow("Running in refinement mode..."));
			},
		};

		try {
			const result = await withSigint((signal) =>
				executePlan(flags, callbacks, cwd, signal),
			);
			printSummary(result);
		} catch (err) {
			if (err instanceof AbortError) {
				printInterrupted(err.specName, err.completedIterations);
			} else {
				throw err;
			}
		}
		return;
	}

	// Interactive mode — TTY only
	if (!isTTY()) {
		console.error(chalk.red("No --all or --spec flag provided. Use --all or --spec in non-interactive mode."));
		process.exitCode = 1;
		return;
	}

	const discovered = discoverSpecs(cwd, config);
	if (discovered.length === 0) {
		console.log("No specs found.");
		return;
	}

	const pending = filterByStatus(discovered, "pending");
	if (pending.length === 0) {
		console.log("No pending specs to plan. All specs have been planned.");
		return;
	}

	const status = readStatus(cwd);
	const selected = await selectSpecs(pending, status.specs);

	if (selected.length === 0) {
		console.log("No specs selected.");
		return;
	}

	// Cast SpecFile[] back to Spec[] (selectSpecs returns SpecFile but our discovered are Spec)
	const selectedSpecs = selected as Spec[];

	try {
		const result = await withSigint((signal) =>
			executePlanAll(flags, makePlanAllCallbacks(verbose), cwd, signal, selectedSpecs),
		);
		printAllSummary(result);
	} catch (err) {
		if (err instanceof AbortError) {
			printInterrupted(err.specName, err.completedIterations);
		} else {
			throw err;
		}
	}
}

