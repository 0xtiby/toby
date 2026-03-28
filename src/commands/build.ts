import chalk from "chalk";
import type { CliEvent } from "@0xtiby/spawner";
import { loadConfig, resolveCommandConfig } from "../lib/config.js";
import { discoverSpecs, filterByStatus, findSpec, findSpecs, sortSpecs } from "../lib/specs.js";
import type { Spec } from "../lib/specs.js";
import { loadPrompt, computeCliVars, resolveTemplateVars, computeSpecSlug, generateSessionName } from "../lib/template.js";
import { runLoop } from "../lib/loop.js";
import type { IterationResult } from "../lib/loop.js";
import {
	readStatus,
	writeStatus,
	addIteration,
	updateSpecStatus,
	createSession,
	clearSession,
	updateSessionState,
} from "../lib/status.js";
import { ensureLocalDir } from "../lib/paths.js";
import type { CommandFlags, CliName, Iteration, IterationState, TemplateVars, PromptName, StatusData, SpecFile, SpecStatusEntry, StopReason } from "../types.js";
import { formatMaxIterationsWarning } from "../lib/format.js";
import { AbortError } from "../lib/errors.js";
import { withTranscript } from "../lib/transcript.js";
import type { TranscriptWriter } from "../lib/transcript.js";
import { writeEvent } from "../ui/stream.js";
import { isTTY } from "../ui/tty.js";
import { selectSpecs } from "../ui/prompt.js";
import { withSigint } from "../ui/signal.js";

export type BuildFlags = CommandFlags;

export interface BuildCallbacks {
	onPhase?: (phase: string) => void;
	onIteration?: (current: number, max: number) => void;
	onEvent?: (event: CliEvent) => void;
	onOutput?: (message: string) => void;
}

export interface BuildResult {
	specName: string;
	totalIterations: number;
	maxIterations: number;
	totalTokens: number;
	totalCost: number;
	specDone: boolean;
	stopReason: StopReason;
	error?: string;
}

interface RunSpecBuildOptions {
	spec: SpecFile;
	promptName: PromptName;
	existingIterations: number;
	iterations: number;
	cli: CliName;
	model?: string;
	templateVars: TemplateVars;
	specsDir: string;
	session: string;
	sessionId?: string;
	specIndex: number;
	specCount: number;
	specs: string[];
	cwd: string;
	abortSignal?: AbortSignal;
	callbacks: BuildCallbacks;
	writer?: TranscriptWriter | null;
}

/**
 * Resolve the sessionId for conversation continuity when resuming a spec.
 * Returns the last iteration's sessionId if the CLI matches, undefined otherwise.
 */
export function resolveResumeSessionId(
	specEntry: SpecStatusEntry | undefined,
	currentCli: string,
	sessionCli: string,
): string | undefined {
	if (currentCli !== sessionCli) return undefined;
	const lastIteration = specEntry?.iterations.at(-1);
	return lastIteration?.sessionId ?? undefined;
}

async function runSpecBuild(options: RunSpecBuildOptions): Promise<{ result: BuildResult; status: StatusData }> {
	const { spec, iterations, cli, model, cwd, callbacks } = options;
	let status = readStatus(cwd);
	let iterationStartTime = new Date().toISOString();

	callbacks.onPhase?.("building");
	callbacks.onIteration?.(1, iterations);

	const loopResult = await runLoop({
		maxIterations: iterations,
		getPrompt: (iteration) => {
			const cliVars = computeCliVars({
				specName: spec.name,
				iteration: iteration + options.existingIterations,
				specIndex: options.specIndex,
				specCount: options.specCount,
				session: options.session,
				specs: options.specs,
				specsDir: options.specsDir,
			});
			const vars = resolveTemplateVars(cliVars, options.templateVars);
			return loadPrompt(options.promptName, vars, { cwd });
		},
		cli,
		model,
		cwd,
		sessionId: options.sessionId,
		continueSession: true,
		abortSignal: options.abortSignal,
		onEvent: (event) => {
			options.writer?.writeEvent(event);
			callbacks.onEvent?.(event);
		},
		onIterationStart: (iteration: number, sessionId: string | null) => {
			iterationStartTime = new Date().toISOString();
			const iterationRecord: Iteration = {
				type: "build",
				iteration: iteration + options.existingIterations,
				sessionId,
				state: "in_progress" as IterationState,
				cli,
				model: model ?? "default",
				startedAt: iterationStartTime,
				completedAt: null,
				exitCode: null,
				taskCompleted: null,
				tokensUsed: null,
				inputTokens: null,
				outputTokens: null,
				cost: null,
			};
			status = addIteration(status, spec.name, iterationRecord);
			writeStatus(status, cwd);
		},
		onIterationComplete: (iterResult: IterationResult) => {
			options.writer?.writeIterationHeader({
				iteration: iterResult.iteration,
				total: iterations,
				cli,
				model: iterResult.model ?? model ?? "default",
			});

			// Determine final state
			const state: IterationState = iterResult.sentinelDetected ? "complete" : "failed";

			// Update the last iteration record (written by onIterationStart)
			const specEntry = status.specs[spec.name];
			const iters = [...specEntry.iterations];
			iters[iters.length - 1] = {
				...iters[iters.length - 1],
				state,
				sessionId: iterResult.sessionId,
				model: iterResult.model ?? iters[iters.length - 1].model,
				completedAt: new Date().toISOString(),
				exitCode: iterResult.exitCode,
				tokensUsed: iterResult.tokensUsed,
				inputTokens: iterResult.inputTokens,
				outputTokens: iterResult.outputTokens,
				cost: iterResult.cost,
			};
			status = {
				...status,
				specs: {
					...status.specs,
					[spec.name]: { ...specEntry, iterations: iters },
				},
			};
			writeStatus(status, cwd);
			callbacks.onIteration?.(iterResult.iteration + 1, iterations);
		},
	});

	// Persist stopReason on spec entry.
	// Note: if aborted, the last iteration remains "in_progress" (since onIterationComplete never ran),
	// so isCrashResume will correctly fire on next run — abort detection relies on iteration state, not stopReason.
	const specEntryAfterLoop = status.specs[spec.name] ?? { status: "building", plannedAt: null, iterations: [] };
	status = {
		...status,
		specs: {
			...status.specs,
			[spec.name]: { ...specEntryAfterLoop, stopReason: loopResult.stopReason },
		},
	};

	if (loopResult.stopReason === "aborted") {
		status = updateSpecStatus(status, spec.name, "building");
		writeStatus(status, cwd);
		throw new AbortError(spec.name, loopResult.iterations.length);
	}

	const totalIterations = loopResult.iterations.length;
	const totalTokens = loopResult.iterations.reduce((sum, r) => sum + (r.tokensUsed ?? 0), 0);
	const totalCost = loopResult.iterations.reduce((sum, r) => sum + (r.cost ?? 0), 0);

	if (loopResult.stopReason === "error") {
		status = updateSpecStatus(status, spec.name, "building");
		writeStatus(status, cwd);
		const lastIter = loopResult.iterations[loopResult.iterations.length - 1];
		const errorMsg = `Build failed after ${totalIterations} iteration(s). Last exit code: ${lastIter?.exitCode ?? "unknown"}`;
		return { result: { specName: spec.name, totalIterations, maxIterations: iterations, totalTokens, totalCost, specDone: false, stopReason: loopResult.stopReason, error: errorMsg }, status };
	}

	const specDone = loopResult.stopReason === "sentinel";
	status = updateSpecStatus(status, spec.name, specDone ? "done" : "building");
	writeStatus(status, cwd);

	return { result: { specName: spec.name, totalIterations, maxIterations: iterations, totalTokens, totalCost, specDone, stopReason: loopResult.stopReason }, status };
}

/**
 * Core build logic, separated from Ink rendering for testability.
 */
export async function executeBuild(
	flags: BuildFlags,
	callbacks: BuildCallbacks = {},
	cwd: string = process.cwd(),
	abortSignal?: AbortSignal,
	externalWriter?: TranscriptWriter | null,
): Promise<BuildResult> {
	ensureLocalDir(cwd);

	const config = loadConfig(cwd);
	const commandConfig = resolveCommandConfig(config, "build", {
		cli: flags.cli as "claude" | "codex" | "opencode" | undefined,
		iterations: flags.iterations,
	});

	if (!flags.spec) {
		throw new Error("No --spec flag provided. Usage: toby build --spec=<name>");
	}

	const specs = discoverSpecs(cwd, config);
	if (specs.length === 0) {
		throw new Error("No specs found in specs/");
	}

	const found = findSpec(specs, flags.spec);
	if (!found) {
		throw new Error(`Spec '${flags.spec}' not found`);
	}

	let status = readStatus(cwd);
	const specEntry = status.specs[found.name];

	// Done guard: refuse to rebuild a completed spec
	if (specEntry?.status === "done") {
		throw new Error(`Spec '${found.name}' is already done. Reset its status in .toby/status.json to rebuild.`);
	}

	if (!specEntry || (specEntry.status !== "planned" && specEntry.status !== "building")) {
		throw new Error(`No plan found for ${found.name}. Run 'toby plan --spec=${flags.spec}' first.`);
	}

	const existingIterations = specEntry.iterations.length;

	// Session name: reuse existing session name on resume, or compute from spec slug
	const session = flags.session || (status.session?.name) || computeSpecSlug(found.name);

	// Resolve per-spec sessionId for conversation continuity
	const sessionCli = status.session?.cli ?? commandConfig.cli;
	const resumeSessionId = resolveResumeSessionId(specEntry, commandConfig.cli, sessionCli);

	// Create session before first iteration
	if (!status.session) {
		const sessionObj = createSession(session, commandConfig.cli, [found.name]);
		status = { ...status, session: sessionObj };
		writeStatus(status, cwd);
	}

	return withTranscript(
		{ flags, config, command: "build", specName: found.name },
		externalWriter,
		async (writer) => {
			const { result } = await runSpecBuild({
				spec: found,
				promptName: "PROMPT_BUILD",
				existingIterations,
				iterations: commandConfig.iterations,
				cli: commandConfig.cli,
				model: commandConfig.model,
				templateVars: config.templateVars,
				specsDir: config.specsDir,
				session,
				sessionId: resumeSessionId,
				specIndex: 1,
				specCount: 1,
				specs: [found.name],
				cwd,
				abortSignal,
				callbacks,
				writer,
			});

			// Session cleanup: clear on success, mark interrupted on failure
			let finalStatus = readStatus(cwd);
			if (result.specDone) {
				finalStatus = clearSession(finalStatus);
			} else {
				finalStatus = updateSessionState(finalStatus, "interrupted");
			}
			writeStatus(finalStatus, cwd);

			return result;
		},
	);
}

export interface BuildAllCallbacks {
	onSpecStart?: (specName: string, index: number, total: number) => void;
	onSpecComplete?: (result: BuildResult) => void;
	onPhase?: (phase: string) => void;
	onIteration?: (current: number, max: number) => void;
	onEvent?: (event: CliEvent) => void;
	onOutput?: (message: string) => void;
}

export interface BuildAllResult {
	built: BuildResult[];
}

/**
 * Build all planned specs in NN- order.
 * Each spec gets its own iteration counter (resets to 1).
 * Uses PROMPT_BUILD template with session vars for multi-spec coordination.
 */
export async function executeBuildAll(
	flags: BuildFlags,
	callbacks: BuildAllCallbacks = {},
	cwd: string = process.cwd(),
	abortSignal?: AbortSignal,
	specs?: Spec[],
): Promise<BuildAllResult> {
	ensureLocalDir(cwd);

	const config = loadConfig(cwd);
	let planned: Spec[];

	if (specs) {
		// Pre-resolved specs (from multi-spec mode) — use directly
		planned = specs;
	} else {
		// Discovery mode — find and filter planned/building specs
		const discovered = discoverSpecs(cwd, config);

		if (discovered.length === 0) {
			throw new Error("No specs found in specs/");
		}

		planned = sortSpecs([...filterByStatus(discovered, "planned"), ...filterByStatus(discovered, "building")]);
		if (planned.length === 0) {
			throw new Error("No planned specs found. Run 'toby plan' first.");
		}
	}

	const built: BuildResult[] = [];
	const specNames = planned.map((s) => s.name);
	let status = readStatus(cwd);

	// Filter out done specs (silent skip) — buildable is the loop target
	const buildable = planned.filter((spec) => {
		const entry = status.specs[spec.name];
		return entry?.status !== "done";
	});

	// Session name: reuse existing session name on resume, or generate new
	const commandConfig = resolveCommandConfig(config, "build", {
		cli: flags.cli as "claude" | "codex" | "opencode" | undefined,
		iterations: flags.iterations,
	});
	const session = flags.session || (status.session?.name) || generateSessionName();
	const sessionCli = status.session?.cli ?? commandConfig.cli;

	// Session management: create if none exists, reuse if resuming
	const existingSession = status.session;
	if (!existingSession) {
		const sessionObj = createSession(session, commandConfig.cli, specNames);
		status = { ...status, session: sessionObj };
		writeStatus(status, cwd);
	} else {
		// Resume path: session already exists, update state to active
		status = updateSessionState(status, "active");
		writeStatus(status, cwd);
	}
	const sessionObj = status.session!;

	return withTranscript(
		{ flags: { ...flags, session: flags.session ?? session }, config, command: "build" },
		undefined,
		async (writer) => {
			try {
				for (let i = 0; i < buildable.length; i++) {
					const spec = buildable[i];
					// Use planned list for consistent specIndex/specCount across builds and resumes
					const specIndex = planned.indexOf(spec) + 1;
					writer?.writeSpecHeader(specIndex, planned.length, spec.name);
					callbacks.onSpecStart?.(spec.name, specIndex - 1, planned.length);

					// Per-spec sessionId resolution for conversation continuity
					const specEntry = status.specs[spec.name];
					const existingIterations = specEntry?.iterations.length ?? 0;
					const resumeSessionId = resolveResumeSessionId(specEntry, commandConfig.cli, sessionCli);

					const { result } = await runSpecBuild({
						spec,
						promptName: "PROMPT_BUILD",
						existingIterations,
						iterations: commandConfig.iterations,
						cli: commandConfig.cli,
						model: commandConfig.model,
						templateVars: config.templateVars,
						specsDir: config.specsDir,
						session,
						sessionId: resumeSessionId,
						specIndex,
						specCount: planned.length,
						specs: specNames,
						cwd,
						abortSignal,
						callbacks: {
							onPhase: callbacks.onPhase,
							onIteration: callbacks.onIteration,
							onEvent: callbacks.onEvent,
							onOutput: callbacks.onOutput,
						},
						writer,
					});

					built.push(result);
					callbacks.onSpecComplete?.(result);

					// Stop on error: non-sentinel stop breaks the loop
					if (!result.specDone) {
						let currentStatus = readStatus(cwd);
						currentStatus = updateSessionState(currentStatus, "interrupted");
						writeStatus(currentStatus, cwd);

						// Summary output
						const allSpecNames = sessionObj.specs;
						const doneSpecs = allSpecNames.filter((name) => {
							return currentStatus.specs[name]?.status === "done";
						});
						const remainingSpecs = allSpecNames.filter((name) => !doneSpecs.includes(name));

						const reason = result.stopReason === "max_iterations"
							? formatMaxIterationsWarning(result.totalIterations, result.maxIterations)
							: result.error ?? "incomplete";
						callbacks.onOutput?.(
							`Session "${sessionObj.name}" interrupted at ${spec.name}: ${reason}.`,
						);
						callbacks.onOutput?.(
							`Completed: ${doneSpecs.join(", ") || "none"} (${doneSpecs.length}/${allSpecNames.length})`,
						);
						callbacks.onOutput?.(
							`Remaining: ${remainingSpecs.join(", ")} (${remainingSpecs.length}/${allSpecNames.length})`,
						);
						callbacks.onOutput?.("Run 'toby resume' to continue.");
						break;
					}
				}
			} catch (err) {
				// Handle AbortError (Ctrl+C): set session state before re-throwing
				if (err instanceof AbortError) {
					const currentStatus = readStatus(cwd);
					writeStatus(updateSessionState(currentStatus, "interrupted"), cwd);
				}
				throw err;
			}

			// If all session specs are done, clear session
			const finalStatus = readStatus(cwd);
			const allDone = sessionObj.specs.every((name) => finalStatus.specs[name]?.status === "done");
			if (allDone) {
				writeStatus(clearSession(finalStatus), cwd);
			}

			return { built };
		},
	);
}

// ── Imperative CLI helpers ────────────────────────────────────────

export interface RunBuildOptions {
	spec?: string;
	all?: boolean;
	verbose?: boolean;
	transcript?: boolean;
	iterations?: number;
	cli?: string;
	session?: string;
}

function printBuildSummary(result: BuildResult): void {
	if (result.error) {
		console.log(chalk.red(`✗ ${result.error}`));
		return;
	}
	if (result.stopReason === "max_iterations") {
		console.log(chalk.yellow(`⚠️ Spec "${result.specName}": ${formatMaxIterationsWarning(result.totalIterations, result.maxIterations)}`));
	} else {
		console.log(chalk.green(`✔ Build complete for ${result.specName}`));
		console.log(`  Iterations: ${result.totalIterations}, Tokens: ${result.totalTokens}`);
	}
}

function printBuildAllSummary(result: BuildAllResult): void {
	const totalIter = result.built.reduce((s, r) => s + r.totalIterations, 0);
	const totalTok = result.built.reduce((s, r) => s + r.totalTokens, 0);
	const hasWarnings = result.built.some((r) => r.stopReason === "max_iterations");
	console.log(
		hasWarnings
			? chalk.yellow(`⚠️ All specs built (${result.built.length} built). Session cleared.`)
			: chalk.green(`✔ All specs built (${result.built.length} built). Session cleared.`),
	);
	for (const r of result.built) {
		if (r.stopReason === "max_iterations") {
			console.log(chalk.yellow(`  ⚠️ ${r.specName}: ${formatMaxIterationsWarning(r.totalIterations, r.maxIterations)}`));
		} else {
			console.log(`  ${r.specName}: ${r.totalIterations} iterations, ${r.totalTokens} tokens${r.specDone ? " [done]" : ""}`);
		}
	}
	console.log(chalk.dim(`  Total: ${totalIter} iterations, ${totalTok} tokens`));
}

function printBuildInterrupted(specName: string, completedIterations: number): void {
	console.log(chalk.yellow(`⚠ Building interrupted for ${specName}`));
	console.log(chalk.dim(`  ${completedIterations} iteration(s) completed, partial status saved`));
	console.log(chalk.dim("  Session saved. Resume with: toby resume"));
}

function makeBuildAllCallbacks(verbose: boolean): BuildAllCallbacks {
	return {
		onEvent: (event) => writeEvent(event, verbose),
		onSpecStart: (name, i, total) => {
			console.log(chalk.dim(`◇ Building ${name} (${i + 1}/${total})`));
		},
		onSpecComplete: (result) => {
			if (result.stopReason === "max_iterations") {
				console.log(chalk.yellow(`⚠️ ${result.specName}: ${formatMaxIterationsWarning(result.totalIterations, result.maxIterations)}`));
			} else {
				console.log(chalk.green(`✔ ${result.specName} done (${result.totalIterations} iterations, ${result.totalTokens} tokens)${result.specDone ? " — sentinel" : ""}`));
			}
		},
		onOutput: (msg) => console.log(chalk.dim(msg)),
	};
}

/**
 * Imperative CLI wrapper for build command.
 */
export async function runBuild(opts: RunBuildOptions): Promise<void> {
	const cwd = process.cwd();
	const config = loadConfig(cwd);
	const verbose = opts.verbose ?? config.verbose ?? false;

	const flags: BuildFlags = {
		spec: opts.spec,
		all: opts.all ?? false,
		verbose,
		transcript: opts.transcript,
		iterations: opts.iterations,
		cli: opts.cli,
		session: opts.session,
	};

	// Resolve specs to build
	let specsToRun: Spec[] | undefined;
	let runSingle = false;

	if (flags.all) {
		const discovered = discoverSpecs(cwd, config);
		if (discovered.length === 0) {
			console.log("No specs found.");
			return;
		}
		specsToRun = sortSpecs([
			...filterByStatus(discovered, "planned"),
			...filterByStatus(discovered, "building"),
		]);
		if (specsToRun.length === 0) {
			console.log("No planned specs found. Run 'toby plan' first.");
			return;
		}
	} else if (flags.spec?.includes(",")) {
		const discovered = discoverSpecs(cwd, config);
		if (discovered.length === 0) {
			console.log("No specs found.");
			return;
		}
		try {
			specsToRun = findSpecs(discovered, flags.spec);
		} catch (err) {
			const available = discovered.map((s) => s.name).join(", ");
			console.error(chalk.red(`${(err as Error).message}. Available: ${available}`));
			process.exitCode = 1;
			return;
		}
	} else if (flags.spec) {
		// Single spec — delegate to executeBuild which validates status
		runSingle = true;
	} else {
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

		const buildable = sortSpecs([
			...filterByStatus(discovered, "planned"),
			...filterByStatus(discovered, "building"),
		]);
		if (buildable.length === 0) {
			console.log("No planned specs found. Run 'toby plan' first.");
			return;
		}

		const status = readStatus(cwd);
		const selected = await selectSpecs(buildable, status.specs);
		if (selected.length === 0) {
			console.log("No specs selected.");
			return;
		}
		specsToRun = selected as Spec[];
	}

	if (runSingle) {
		const callbacks: BuildCallbacks = {
			onEvent: (event) => writeEvent(event, verbose),
			onIteration: (current, max) => {
				console.log(chalk.dim(`  Iteration ${current}/${max}`));
			},
		};

		try {
			const result = await withSigint((signal) =>
				executeBuild(flags, callbacks, cwd, signal),
			);
			printBuildSummary(result);
		} catch (err) {
			if (err instanceof AbortError) {
				printBuildInterrupted(err.specName, err.completedIterations);
			} else if (err instanceof Error) {
				console.error(chalk.red(err.message));
				process.exitCode = 1;
			} else {
				throw err;
			}
		}
		return;
	}

	try {
		const result = await withSigint((signal) =>
			executeBuildAll(flags, makeBuildAllCallbacks(verbose), cwd, signal, specsToRun),
		);
		printBuildAllSummary(result);
	} catch (err) {
		if (err instanceof AbortError) {
			printBuildInterrupted(err.specName, err.completedIterations);
		} else {
			throw err;
		}
	}
}
