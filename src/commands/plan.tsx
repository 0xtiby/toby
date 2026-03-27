import React, { useState, useEffect, useMemo } from "react";
import { Text, Box } from "ink";
import type { CliEvent } from "@0xtiby/spawner";
import { loadConfig, resolveCommandConfig } from "../lib/config.js";
import { discoverSpecs, filterByStatus, findSpec } from "../lib/specs.js";
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
import type { Iteration, StopReason } from "../types.js";
import { AbortError } from "../lib/errors.js";
import { withTranscript } from "../lib/transcript.js";
import type { TranscriptWriter } from "../lib/transcript.js";
import { useCommandRunner } from "../hooks/useCommandRunner.js";
import type { CommandFlags } from "../hooks/useCommandRunner.js";
import MultiSpecSelector from "../components/MultiSpecSelector.js";
import StreamOutput from "../components/StreamOutput.js";

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

			return {
			specName: found.name,
			totalIterations: loopResult.iterations.length,
			maxIterations: commandConfig.iterations,
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

export default function Plan(flags: PlanFlags) {
	const runner = useCommandRunner({
		flags,
		runPhase: "planning",
		filterSpecs: (specs) => filterByStatus(specs, "pending"),
		emptyMessage: "No pending specs to plan. All specs have been planned.",
	});

	const [result, setResult] = useState<PlanResult | null>(null);
	const [allResult, setAllResult] = useState<PlanAllResult | null>(null);
	const [refinementInfo, setRefinementInfo] = useState<{ specName: string } | null>(null);

	const allCallbacks: PlanAllCallbacks = useMemo(() => ({
		onSpecStart: runner.onSpecStartCallback,
		onSpecComplete: () => {},
		onPhase: runner.onPhaseCallback,
		onRefinement: (name: string) => { setRefinementInfo({ specName: name }); },
		onIteration: runner.onIterationCallback,
		onEvent: runner.addEvent,
	}), [runner.onSpecStartCallback, runner.onPhaseCallback, runner.onIterationCallback, runner.addEvent]);

	// Run multi-spec mode (specs resolved by useCommandRunner)
	useEffect(() => {
		if (runner.phase !== "multi" || runner.selectedSpecs.length === 0) return;
		executePlanAll(flags, allCallbacks, undefined, runner.abortSignal, runner.selectedSpecs)
			.then((r) => { setAllResult(r); runner.handleDone(); })
			.catch(runner.handleError);
	}, [runner.phase, runner.selectedSpecs]);

	// Run --all mode
	useEffect(() => {
		if (runner.phase !== "all") return;
		executePlanAll(flags, allCallbacks, undefined, runner.abortSignal)
			.then((r) => { setAllResult(r); runner.handleDone(); })
			.catch(runner.handleError);
	}, [runner.phase]);

	// Run single mode
	useEffect(() => {
		if (runner.phase !== "init") return;
		executePlan(runner.activeFlags, {
			onPhase: runner.onPhaseCallback,
			onRefinement: (name) => { setRefinementInfo({ specName: name }); },
			onIteration: runner.onIterationCallback,
			onEvent: runner.addEvent,
		}, undefined, runner.abortSignal)
			.then((r) => { runner.setSpecName(r.specName); setResult(r); runner.handleDone(); })
			.catch(runner.handleError);
	}, [runner.activeFlags, runner.phase]);

	if (runner.phase === "interrupted" && runner.interruptInfo) {
		return (
			<Box flexDirection="column">
				<Text color="yellow">{`⚠ Planning interrupted for ${runner.interruptInfo.specName}`}</Text>
				<Text dimColor>{`  ${runner.interruptInfo.iterations} iteration(s) completed, partial status saved`}</Text>
			</Box>
		);
	}

	if (runner.phase === "error") {
		return <Text color="red">{runner.errorMessage}</Text>;
	}

	if (runner.phase === "selecting") {
		return <MultiSpecSelector specs={runner.specs} onConfirm={runner.handleMultiSpecConfirm} />;
	}

	if (runner.phase === "done" && allResult) {
		const hasWarnings = allResult.planned.some((r) => r.stopReason === "max_iterations");
		return (
			<Box flexDirection="column">
				<Text color={hasWarnings ? "yellow" : "green"}>
					{`${hasWarnings ? "⚠️" : "✓"} All specs planned (${allResult.planned.length} planned)`}
				</Text>
				{allResult.planned.map((r) => (
					<Text key={r.specName} color={r.stopReason === "max_iterations" ? "yellow" : undefined}>
						{r.stopReason === "max_iterations"
							? `  ⚠️ ${r.specName}: max iteration limit reached (${r.totalIterations}/${r.maxIterations})`
							: `  ${r.specName}`}
					</Text>
				))}
			</Box>
		);
	}

	if (runner.phase === "done" && result) {
		if (result.stopReason === "max_iterations") {
			return (
				<Box flexDirection="column">
					<Text color="yellow">
						{`⚠️ Spec "${result.specName}": maximum plan iteration limit reached (${result.totalIterations}/${result.maxIterations} iterations).`}
					</Text>
				</Box>
			);
		}
		return (
			<Box flexDirection="column">
				<Text color="green">{`✓ Plan complete for ${result.specName}`}</Text>
			</Box>
		);
	}

	return (
		<Box flexDirection="column">
			{refinementInfo && (
				<>
					<Text color="yellow">{`Existing plan found for ${refinementInfo.specName}`}</Text>
					<Text color="yellow">Running in refinement mode...</Text>
				</>
			)}
			{runner.allProgress.total > 0 && (
				<Text dimColor>{`[${runner.allProgress.current}/${runner.allProgress.total}]`}</Text>
			)}
			<Text dimColor>
				{`Planning: ${runner.specName || runner.activeFlags.spec} (iteration ${Math.min(runner.currentIteration, runner.maxIterations)}/${runner.maxIterations})`}
			</Text>
			<Text dimColor>{"─".repeat(40)}</Text>
			<StreamOutput events={runner.events} verbose={runner.resolvedVerbose} />
		</Box>
	);
}
