import React, { useState, useEffect } from "react";
import { Text, Box } from "ink";
import type { CliEvent } from "@0xtiby/spawner";
import { loadConfig, resolveCommandConfig } from "../lib/config.js";
import { discoverSpecs, filterByStatus, findSpec, loadSpecContent } from "../lib/specs.js";
import { loadPrompt } from "../lib/template.js";
import { runLoop } from "../lib/loop.js";
import type { IterationResult } from "../lib/loop.js";
import {
	readStatus,
	writeStatus,
	addIteration,
	updateSpecStatus,
} from "../lib/status.js";
import { ensureLocalDir } from "../lib/paths.js";
import type { Iteration } from "../types.js";
import { AbortError } from "../lib/errors.js";
import { useCommandRunner } from "../hooks/useCommandRunner.js";
import type { CommandFlags } from "../hooks/useCommandRunner.js";
import SpecSelector from "../components/SpecSelector.js";
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
}

/**
 * Core planning logic, separated from Ink rendering for testability.
 */
export async function executePlan(
	flags: PlanFlags,
	callbacks: PlanCallbacks = {},
	cwd: string = process.cwd(),
	abortSignal?: AbortSignal,
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

	const specWithContent = loadSpecContent(found);

	// Detect refinement mode: status 'planned' means we're refining
	let status = readStatus(cwd);
	const specEntry = status.specs[found.name];
	const existingIterations = specEntry?.iterations.length ?? 0;
	const isRefinement = specEntry?.status === "planned";

	if (isRefinement) {
		callbacks.onRefinement?.(found.name);
	}

	let iterationStartTime = new Date().toISOString();
	callbacks.onPhase?.("planning");
	callbacks.onIteration?.(1, commandConfig.iterations);

	const loopResult = await runLoop({
		maxIterations: commandConfig.iterations,
		getPrompt: (iteration) =>
			loadPrompt(
				"PROMPT_PLAN",
				{
					SPEC_NAME: found.name,
					ITERATION: String(iteration + existingIterations),
					SPEC_CONTENT: specWithContent.content ?? "",
				},
				{ cwd, configVars: commandConfig.templateVars },
			),
		cli: commandConfig.cli,
		model: commandConfig.model,
		cwd,
		continueSession: true,
		abortSignal,
		onEvent: (event) => {
			callbacks.onEvent?.(event);
		},
		onIterationComplete: (iterResult: IterationResult) => {
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

	return { specName: found.name };
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
	skipped: string[];
}

/**
 * Plan all pending specs in NN- order.
 * Specs with status 'planned' or later are skipped.
 * Stops on first failure.
 */
export async function executePlanAll(
	flags: PlanFlags,
	callbacks: PlanAllCallbacks = {},
	cwd: string = process.cwd(),
	abortSignal?: AbortSignal,
): Promise<PlanAllResult> {
	ensureLocalDir(cwd);

	const config = loadConfig(cwd);
	const specs = discoverSpecs(cwd, config);

	if (specs.length === 0) {
		throw new Error("No specs found in specs/");
	}

	const pending = filterByStatus(specs, "pending");
	const skipped = specs.filter((s) => s.status !== "pending").map((s) => s.name);
	const planned: PlanResult[] = [];

	for (let i = 0; i < pending.length; i++) {
		const spec = pending[i];
		callbacks.onSpecStart?.(spec.name, i, pending.length);

		const result = await executePlan(
			{ ...flags, spec: spec.name, all: false },
			{
				onPhase: callbacks.onPhase,
				onIteration: callbacks.onIteration,
				onEvent: callbacks.onEvent,
				onRefinement: callbacks.onRefinement,
			},
			cwd,
			abortSignal,
		);

		planned.push(result);
		callbacks.onSpecComplete?.(result);
	}

	return { planned, skipped };
}

export default function Plan(flags: PlanFlags) {
	const runner = useCommandRunner({
		flags,
		runPhase: "planning",
	});

	const [result, setResult] = useState<PlanResult | null>(null);
	const [allResult, setAllResult] = useState<PlanAllResult | null>(null);
	const [refinementInfo, setRefinementInfo] = useState<{ specName: string } | null>(null);

	// Run --all mode
	useEffect(() => {
		if (runner.phase !== "all") return;
		executePlanAll(flags, {
			onSpecStart: runner.onSpecStartCallback,
			onSpecComplete: () => {},
			onPhase: runner.onPhaseCallback,
			onRefinement: (name) => { setRefinementInfo({ specName: name }); },
			onIteration: runner.onIterationCallback,
			onEvent: runner.addEvent,
		}, undefined, runner.abortSignal)
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
		return <SpecSelector specs={runner.specs} onSelect={runner.handleSpecSelect} />;
	}

	if (runner.phase === "done" && allResult) {
		return (
			<Box flexDirection="column">
				<Text color="green">{`✓ All specs planned (${allResult.planned.length} planned, ${allResult.skipped.length} skipped)`}</Text>
				{allResult.planned.map((r) => (
					<Text key={r.specName}>{`  ${r.specName}`}</Text>
				))}
				{allResult.skipped.length > 0 && (
					<Text dimColor>{`  Skipped: ${allResult.skipped.join(", ")}`}</Text>
				)}
			</Box>
		);
	}

	if (runner.phase === "done" && result) {
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
