import React, { useState, useEffect } from "react";
import { Text, Box } from "ink";
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
} from "../lib/status.js";
import { ensureLocalDir } from "../lib/paths.js";
import type { Iteration, TemplateVars, PromptName, StatusData, SpecFile } from "../types.js";
import { AbortError } from "../lib/errors.js";
import { useCommandRunner } from "../hooks/useCommandRunner.js";
import type { CommandFlags } from "../hooks/useCommandRunner.js";
import MultiSpecSelector from "../components/MultiSpecSelector.js";
import StreamOutput from "../components/StreamOutput.js";

export type BuildFlags = CommandFlags;

export interface BuildCallbacks {
	onPhase?: (phase: string) => void;
	onIteration?: (current: number, max: number) => void;
	onEvent?: (event: CliEvent) => void;
}

export interface BuildResult {
	specName: string;
	totalIterations: number;
	totalTokens: number;
	specDone: boolean;
	error?: string;
}

interface RunSpecBuildOptions {
	spec: SpecFile;
	promptName: PromptName;
	existingIterations: number;
	iterations: number;
	cli: string;
	model?: string;
	templateVars: TemplateVars;
	specsDir: string;
	session: string;
	specIndex: number;
	specCount: number;
	specs: string[];
	cwd: string;
	abortSignal?: AbortSignal;
	callbacks: BuildCallbacks;
}

async function runSpecBuild(options: RunSpecBuildOptions): Promise<{ result: BuildResult; status: StatusData }> {
	const { spec, promptName, existingIterations, iterations, cli, model, templateVars, specsDir, session, specIndex, specCount, specs, cwd, abortSignal, callbacks } = options;
	let status = readStatus(cwd);
	let iterationStartTime = new Date().toISOString();

	callbacks.onPhase?.("building");
	callbacks.onIteration?.(1, iterations);

	const loopResult = await runLoop({
		maxIterations: iterations,
		getPrompt: (iteration) => {
			const cliVars = computeCliVars({
				specName: spec.name,
				iteration: iteration + existingIterations,
				specIndex,
				specCount,
				session,
				specs,
				specsDir,
			});
			const vars = resolveTemplateVars(cliVars, templateVars);
			return loadPrompt(promptName, vars, { cwd });
		},
		cli,
		model,
		cwd,
		continueSession: true,
		abortSignal,
		onEvent: (event) => {
			callbacks.onEvent?.(event);
		},
		onIterationComplete: (iterResult: IterationResult) => {
			const completedAt = new Date().toISOString();
			const iteration: Iteration = {
				type: "build",
				iteration: iterResult.iteration,
				sessionId: iterResult.sessionId,
				cli,
				model: iterResult.model ?? model,
				startedAt: iterationStartTime,
				completedAt,
				exitCode: iterResult.exitCode,
				taskCompleted: null,
				tokensUsed: iterResult.tokensUsed,
			};
			iterationStartTime = new Date().toISOString();
			status = addIteration(status, spec.name, iteration);
			writeStatus(status, cwd);
			callbacks.onIteration?.(iterResult.iteration + 1, iterations);
		},
	});

	if (loopResult.stopReason === "aborted") {
		status = updateSpecStatus(status, spec.name, "building");
		writeStatus(status, cwd);
		throw new AbortError(spec.name, loopResult.iterations.length);
	}

	const totalIterations = loopResult.iterations.length;
	const totalTokens = loopResult.iterations.reduce((sum, r) => sum + (r.tokensUsed ?? 0), 0);

	if (loopResult.stopReason === "error") {
		status = updateSpecStatus(status, spec.name, "building");
		writeStatus(status, cwd);
		const lastIter = loopResult.iterations[loopResult.iterations.length - 1];
		const errorMsg = `Build failed after ${totalIterations} iteration(s). Last exit code: ${lastIter?.exitCode ?? "unknown"}`;
		return { result: { specName: spec.name, totalIterations, totalTokens, specDone: false, error: errorMsg }, status };
	}

	const specDone = loopResult.stopReason === "sentinel";
	status = updateSpecStatus(status, spec.name, specDone ? "done" : "building");
	writeStatus(status, cwd);

	return { result: { specName: spec.name, totalIterations, totalTokens, specDone }, status };
}

/**
 * Core build logic, separated from Ink rendering for testability.
 */
export async function executeBuild(
	flags: BuildFlags,
	callbacks: BuildCallbacks = {},
	cwd: string = process.cwd(),
	abortSignal?: AbortSignal,
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

	const status = readStatus(cwd);
	const specEntry = status.specs[found.name];
	if (!specEntry || (specEntry.status !== "planned" && specEntry.status !== "building")) {
		throw new Error(`No plan found for ${found.name}. Run 'toby plan --spec=${flags.spec}' first.`);
	}

	const existingIterations = specEntry.iterations.length;
	const session = flags.session || computeSpecSlug(found.name);

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
		specIndex: 1,
		specCount: 1,
		specs: [found.name],
		cwd,
		abortSignal,
		callbacks,
	});

	return result;
}

export interface BuildAllCallbacks {
	onSpecStart?: (specName: string, index: number, total: number) => void;
	onSpecComplete?: (result: BuildResult) => void;
	onPhase?: (phase: string) => void;
	onIteration?: (current: number, max: number) => void;
	onEvent?: (event: CliEvent) => void;
}

export interface BuildAllResult {
	built: BuildResult[];
	skipped: string[];
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
	let skipped: string[];

	if (specs) {
		// Pre-resolved specs (from multi-spec mode) — use directly
		planned = specs;
		skipped = [];
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

		skipped = discovered.filter((s) => s.status !== "planned" && s.status !== "building").map((s) => s.name);
	}

	const built: BuildResult[] = [];
	const session = flags.session || generateSessionName();
	const specNames = planned.map((s) => s.name);

	for (let i = 0; i < planned.length; i++) {
		const spec = planned[i];
		callbacks.onSpecStart?.(spec.name, i, planned.length);

		const commandConfig = resolveCommandConfig(config, "build", {
			cli: flags.cli as "claude" | "codex" | "opencode" | undefined,
			iterations: flags.iterations,
		});

		const { result } = await runSpecBuild({
			spec,
			promptName: "PROMPT_BUILD",
			existingIterations: 0,
			iterations: commandConfig.iterations,
			cli: commandConfig.cli,
			model: commandConfig.model,
			templateVars: config.templateVars,
			specsDir: config.specsDir,
			session,
			specIndex: i + 1,
			specCount: planned.length,
			specs: specNames,
			cwd,
			abortSignal,
			callbacks: {
				onPhase: callbacks.onPhase,
				onIteration: callbacks.onIteration,
				onEvent: callbacks.onEvent,
			},
		});

		built.push(result);
		callbacks.onSpecComplete?.(result);
	}

	return { built, skipped };
}

export default function Build(flags: BuildFlags) {
	const runner = useCommandRunner({
		flags,
		runPhase: "building",
		filterSpecs: (specs) => {
			const buildable = [...filterByStatus(specs, "planned"), ...filterByStatus(specs, "building")];
			return buildable;
		},
		emptyMessage: "No planned specs found. Run 'toby plan' first.",
	});

	const [result, setResult] = useState<BuildResult | null>(null);
	const [allResult, setAllResult] = useState<BuildAllResult | null>(null);

	// Run multi-spec mode
	useEffect(() => {
		if (runner.phase !== "multi") return;
		const config = loadConfig();
		const allSpecs = discoverSpecs(process.cwd(), config);
		const resolved = findSpecs(allSpecs, flags.spec!);
		executeBuildAll(flags, {
			onSpecStart: runner.onSpecStartCallback,
			onSpecComplete: () => {},
			onPhase: runner.onPhaseCallback,
			onIteration: runner.onIterationCallback,
			onEvent: runner.addEvent,
		}, undefined, runner.abortSignal, resolved)
			.then((r) => { setAllResult(r); runner.handleDone(); })
			.catch(runner.handleError);
	}, [runner.phase]);

	// Run --all mode
	useEffect(() => {
		if (runner.phase !== "all") return;
		executeBuildAll(flags, {
			onSpecStart: runner.onSpecStartCallback,
			onSpecComplete: () => {},
			onPhase: runner.onPhaseCallback,
			onIteration: runner.onIterationCallback,
			onEvent: runner.addEvent,
		}, undefined, runner.abortSignal)
			.then((r) => { setAllResult(r); runner.handleDone(); })
			.catch(runner.handleError);
	}, [runner.phase]);

	// Run single mode
	useEffect(() => {
		if (runner.phase !== "init") return;
		executeBuild(runner.activeFlags, {
			onPhase: runner.onPhaseCallback,
			onIteration: runner.onIterationCallback,
			onEvent: runner.addEvent,
		}, undefined, runner.abortSignal)
			.then((r) => { runner.setSpecName(r.specName); setResult(r); runner.handleDone(); })
			.catch(runner.handleError);
	}, [runner.activeFlags, runner.phase]);

	if (runner.phase === "interrupted" && runner.interruptInfo) {
		return (
			<Box flexDirection="column">
				<Text color="yellow">{`⚠ Building interrupted for ${runner.interruptInfo.specName}`}</Text>
				<Text dimColor>{`  ${runner.interruptInfo.iterations} iteration(s) completed, partial status saved`}</Text>
			</Box>
		);
	}

	if (runner.phase === "error") {
		return <Text color="red">{runner.errorMessage}</Text>;
	}

	if (runner.phase === "selecting") {
		if (runner.specs.length === 0) {
			return <Text dimColor>Loading specs...</Text>;
		}
		return <MultiSpecSelector specs={runner.specs} onConfirm={runner.handleMultiSpecConfirm} title="Select specs to build:" />;
	}

	if (runner.phase === "done" && allResult) {
		const totalIter = allResult.built.reduce((s, r) => s + r.totalIterations, 0);
		const totalTok = allResult.built.reduce((s, r) => s + r.totalTokens, 0);
		return (
			<Box flexDirection="column">
				<Text color="green">{`✓ All specs built (${allResult.built.length} built, ${allResult.skipped.length} skipped)`}</Text>
				{allResult.built.map((r) => (
					<Text key={r.specName}>{`  ${r.specName}: ${r.totalIterations} iterations, ${r.totalTokens} tokens${r.specDone ? " [done]" : ""}`}</Text>
				))}
				<Text dimColor>{`  Total: ${totalIter} iterations, ${totalTok} tokens`}</Text>
				{allResult.skipped.length > 0 && (
					<Text dimColor>{`  Skipped: ${allResult.skipped.join(", ")}`}</Text>
				)}
			</Box>
		);
	}

	if (runner.phase === "done" && result) {
		if (result.error) {
			return (
				<Box flexDirection="column">
					<Text color="red">{`✗ ${result.error}`}</Text>
				</Box>
			);
		}
		return (
			<Box flexDirection="column">
				<Text color="green">{`✓ Build ${result.specDone ? "complete" : "paused"} for ${result.specName}`}</Text>
				<Text>{`  Iterations: ${result.totalIterations}, Tokens: ${result.totalTokens}`}</Text>
			</Box>
		);
	}

	return (
		<Box flexDirection="column">
			{runner.allProgress.total > 0 && (
				<Text dimColor>{`[${runner.allProgress.current}/${runner.allProgress.total}]`}</Text>
			)}
			<Text dimColor>
				{`Building: ${runner.specName || runner.activeFlags.spec} (iteration ${Math.min(runner.currentIteration, runner.maxIterations)}/${runner.maxIterations})`}
			</Text>
			<Text dimColor>{"─".repeat(40)}</Text>
			<StreamOutput events={runner.events} verbose={runner.resolvedVerbose} />
		</Box>
	);
}
