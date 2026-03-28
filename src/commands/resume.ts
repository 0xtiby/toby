import chalk from "chalk";
import { loadConfig, resolveCommandConfig } from "../lib/config.js";
import { discoverSpecs, findSpec } from "../lib/specs.js";
import { readStatus, updateSessionState, hasResumableSession, writeStatus } from "../lib/status.js";
import { executeBuildAll } from "./build.js";
import type { BuildFlags } from "./build.js";
import type { BuildAllCallbacks, BuildAllResult, BuildResult } from "./build.js";
import { formatMaxIterationsWarning } from "../lib/format.js";
import { formatCost } from "../ui/format.js";
import { writeEvent } from "../ui/stream.js";
import { AbortError } from "../lib/errors.js";
import { withSigint } from "../ui/signal.js";

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
	const totalCost = result.built.reduce((s, r) => s + r.totalCost, 0);
	const hasWarnings = result.built.some((r) => r.stopReason === "max_iterations");
	console.log(
		hasWarnings
			? chalk.yellow(`⚠️ All remaining specs built (${result.built.length} spec(s)). Session cleared.`)
			: chalk.green(`✔ All remaining specs built (${result.built.length} spec(s)). Session cleared.`),
	);
	for (const r of result.built) {
		if (r.stopReason === "max_iterations") {
			console.log(chalk.yellow(`  ⚠️ ${r.specName}: ${formatMaxIterationsWarning(r.totalIterations, r.maxIterations)}, ${r.totalTokens} tokens`));
		} else {
			const costSuffix = r.totalCost > 0 ? `, ${formatCost(r.totalCost)}` : "";
			console.log(`  ${r.specName}: ${r.totalIterations} iterations, ${r.totalTokens} tokens${costSuffix}${r.specDone ? " [done]" : ""}`);
		}
	}
	const totalCostSuffix = totalCost > 0 ? `, ${formatCost(totalCost)}` : "";
	console.log(chalk.dim(`  Total: ${totalIter} iterations, ${totalTok} tokens${totalCostSuffix}`));
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
				const costSuffix = result.totalCost > 0 ? `, ${formatCost(result.totalCost)}` : "";
				console.log(chalk.green(`✔ ${result.specName} done (${result.totalIterations} iterations, ${result.totalTokens} tokens${costSuffix})${result.specDone ? " — sentinel" : ""}`));
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

	try {
		const result = await withSigint((signal) =>
			executeResume(
				{ iterations: opts.iterations, verbose, transcript: opts.transcript },
				makeResumeCallbacks(verbose),
				cwd,
				signal,
			),
		);
		printResumeSummary(result);
	} catch (err) {
		if (err instanceof AbortError) {
			console.log(chalk.yellow(`⚠ Building interrupted for ${err.specName}`));
			console.log(chalk.dim(`  ${err.completedIterations} iteration(s) completed, partial status saved`));
			console.log(chalk.dim("  Session saved. Resume with: toby resume"));
		} else if (err instanceof Error) {
			console.error(chalk.red(err.message));
		} else {
			throw err;
		}
	}
}
