import chalk from "chalk";
import { loadConfig, resolveCommandConfig } from "../lib/config.js";
import { discoverSpecs, findSpec } from "../lib/specs.js";
import { readStatus, updateSessionState, hasResumableSession, writeStatus } from "../lib/status.js";
import { executeBuildAll } from "./build.js";
import type { BuildFlags } from "./build.js";
import type { BuildAllCallbacks, BuildAllResult, BuildResult } from "./build.js";
import { formatMaxIterationsWarning } from "../lib/format.js";
import { writeEvent } from "../ui/stream.js";
import { AbortError } from "../lib/errors.js";

export interface ResumeFlags {
	iterations?: number;
	verbose?: boolean;
	transcript?: boolean;
}

export async function executeResume(
	flags: ResumeFlags,
	callbacks: BuildAllCallbacks = {},
	cwd: string = process.cwd(),
	abortSignal?: AbortSignal,
): Promise<BuildAllResult> {
	const status = readStatus(cwd);

	if (!hasResumableSession(status)) {
		throw new Error(
			"No active session to resume. Use 'toby build --spec=<name>' to start a new build.",
		);
	}

	const session = status.session!;
	const config = loadConfig(cwd);
	const commandConfig = resolveCommandConfig(config, "build", {
		iterations: flags.iterations,
	});

	// Discover all specs and resolve session specs
	const allSpecs = discoverSpecs(cwd, config);

	const incompleteNames: string[] = [];
	const missingNames: string[] = [];

	for (const specName of session.specs) {
		// Skip specs already done
		const entry = status.specs[specName];
		if (entry?.status === "done") {
			callbacks.onOutput?.(`  ✓ ${specName} (done, skipping)`);
			continue;
		}

		const found = findSpec(allSpecs, specName);
		if (!found) {
			missingNames.push(specName);
			callbacks.onOutput?.(`  ⚠ ${specName} (not found in specs/, skipping)`);
			continue;
		}

		incompleteNames.push(specName);
	}

	if (missingNames.length === session.specs.length) {
		throw new Error(
			"All session specs are missing from specs/ directory. Cannot resume.",
		);
	}

	if (incompleteNames.length === 0) {
		throw new Error(
			missingNames.length > 0
				? "All remaining session specs are missing from specs/. Nothing to resume."
				: "All specs in this session are already done. Nothing to resume.",
		);
	}

	// Resolve incomplete names to Spec objects
	const specsToResume = incompleteNames.map((name) => findSpec(allSpecs, name)!);

	callbacks.onOutput?.(`Resuming session "${session.name}" with ${specsToResume.length} spec(s):`);
	for (const spec of specsToResume) {
		callbacks.onOutput?.(`  → ${spec.name}`);
	}

	// Update session state to active
	const updatedStatus = updateSessionState(status, "active");
	writeStatus(updatedStatus, cwd);

	// Construct BuildFlags and delegate
	const buildFlags: BuildFlags = {
		spec: undefined,
		all: true,
		iterations: flags.iterations ?? commandConfig.iterations,
		verbose: flags.verbose ?? false,
		transcript: flags.transcript,
		cli: commandConfig.cli,
		session: session.name,
	};

	return executeBuildAll(buildFlags, callbacks, cwd, abortSignal, specsToResume);
}

// ── Imperative CLI helpers ────────────────────────────────────────

export interface RunResumeOptions {
	iterations?: number;
	verbose?: boolean;
	transcript?: boolean;
}

function printResumeSummary(result: BuildAllResult): void {
	const totalIter = result.built.reduce((s, r) => s + r.totalIterations, 0);
	const totalTok = result.built.reduce((s, r) => s + r.totalTokens, 0);
	const hasWarnings = result.built.some((r) => r.stopReason === "max_iterations");
	console.log(
		hasWarnings
			? chalk.yellow(`⚠️ Resume complete (${result.built.length} spec(s) built)`)
			: chalk.green(`✔ Resume complete (${result.built.length} spec(s) built)`),
	);
	for (const r of result.built) {
		if (r.stopReason === "max_iterations") {
			console.log(chalk.yellow(`  ⚠️ ${r.specName}: ${formatMaxIterationsWarning(r.totalIterations, r.maxIterations)}, ${r.totalTokens} tokens`));
		} else {
			console.log(`  ${r.specName}: ${r.totalIterations} iterations, ${r.totalTokens} tokens${r.specDone ? " [done]" : ""}`);
		}
	}
	console.log(chalk.dim(`  Total: ${totalIter} iterations, ${totalTok} tokens`));
}

function makeResumeCallbacks(verbose: boolean): BuildAllCallbacks {
	return {
		onEvent: (event) => writeEvent(event, verbose),
		onOutput: (msg) => console.log(chalk.dim(msg)),
		onSpecStart: (name, i, total) => {
			console.log(chalk.dim(`◇ Building ${name} (${i + 1}/${total})`));
		},
		onSpecComplete: (result: BuildResult) => {
			if (result.stopReason === "max_iterations") {
				console.log(chalk.yellow(`⚠️ ${result.specName}: ${formatMaxIterationsWarning(result.totalIterations, result.maxIterations)}`));
			} else {
				console.log(chalk.green(`✔ ${result.specName} done (${result.totalIterations} iterations, ${result.totalTokens} tokens)${result.specDone ? " — sentinel" : ""}`));
			}
		},
	};
}

/**
 * Imperative CLI wrapper for resume command.
 */
export async function runResume(opts: RunResumeOptions): Promise<void> {
	const cwd = process.cwd();
	const status = readStatus(cwd);

	if (!hasResumableSession(status)) {
		console.log("No active session to resume.");
		return;
	}

	const session = status.session!;
	console.log(chalk.dim(`◇ Resuming session "${session.name}"`));

	const config = loadConfig(cwd);
	const verbose = opts.verbose ?? config.verbose ?? false;

	const abortController = new AbortController();
	const onSigint = () => abortController.abort();
	process.on("SIGINT", onSigint);

	try {
		const result = await executeResume(
			{ iterations: opts.iterations, verbose, transcript: opts.transcript },
			makeResumeCallbacks(verbose),
			cwd,
			abortController.signal,
		);
		printResumeSummary(result);
	} catch (err) {
		if (err instanceof AbortError) {
			console.log(chalk.yellow(`⚠ Building interrupted for ${err.specName}`));
			console.log(chalk.dim(`  ${err.completedIterations} iteration(s) completed, partial status saved`));
		} else if (err instanceof Error) {
			console.error(chalk.red(err.message));
		} else {
			throw err;
		}
	} finally {
		process.off("SIGINT", onSigint);
	}
}
