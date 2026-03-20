import React, { useState, useEffect } from "react";
import { Text, Box } from "ink";
import type { CliEvent } from "@0xtiby/spawner";
import { loadConfig, resolveCommandConfig } from "../lib/config.js";
import { discoverSpecs, filterByStatus, findSpec, loadSpecContent, sortSpecs } from "../lib/specs.js";
import { loadPrompt } from "../lib/template.js";
import { runLoop } from "../lib/loop.js";
import type { IterationResult } from "../lib/loop.js";
import {
	readStatus,
	writeStatus,
	addIteration,
	updateSpecStatus,
} from "../lib/status.js";
import { getPrdPath, hasPrd, readPrd, getTaskSummary } from "../lib/prd.js";
import { ensureLocalDir } from "../lib/paths.js";
import type { Iteration } from "../types.js";
import { AbortError } from "../lib/errors.js";
import { useCommandRunner } from "../hooks/useCommandRunner.js";
import type { CommandFlags } from "../hooks/useCommandRunner.js";
import SpecSelector from "../components/SpecSelector.js";
import StreamOutput from "../components/StreamOutput.js";

export type BuildFlags = CommandFlags;

export interface BuildCallbacks {
	onPhase?: (phase: string) => void;
	onIteration?: (current: number, max: number) => void;
	onEvent?: (event: CliEvent) => void;
}

export interface BuildResult {
	specName: string;
	taskCount: number;
	prdPath: string;
	totalIterations: number;
	totalTokens: number;
	specDone: boolean;
	error?: string;
	remainingTasks?: number;
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

	if (!hasPrd(found.name, cwd)) {
		throw new Error(`No plan found for ${found.name}. Run 'toby plan --spec=${flags.spec}' first.`);
	}

	const specWithContent = loadSpecContent(found);
	const prdPath = getPrdPath(found.name, cwd);

	// Check task state before starting the loop
	const preBuildPrd = readPrd(found.name, cwd);
	if (preBuildPrd) {
		const preSummary = getTaskSummary(preBuildPrd);
		const totalTasks = Object.values(preSummary).reduce((a, b) => a + b, 0);

		if (totalTasks === 0) {
			return { specName: found.name, taskCount: 0, prdPath, totalIterations: 0, totalTokens: 0, specDone: true };
		}

		if (preSummary.done === totalTasks) {
			return { specName: found.name, taskCount: totalTasks, prdPath, totalIterations: 0, totalTokens: 0, specDone: true };
		}
	}

	let status = readStatus(cwd);
	const specStatus = status.specs[found.name];
	const existingIterations = specStatus?.iterations.length ?? 0;

	let iterationStartTime = new Date().toISOString();
	callbacks.onPhase?.("building");
	callbacks.onIteration?.(1, commandConfig.iterations);

	const loopResult = await runLoop({
		maxIterations: commandConfig.iterations,
		getPrompt: (iteration) =>
			loadPrompt(
				"PROMPT_BUILD",
				{
					SPEC_NAME: found.name,
					ITERATION: String(iteration + existingIterations),
					SPEC_CONTENT: specWithContent.content ?? "",
					PRD_PATH: prdPath,
					BRANCH: "",
					WORKTREE: "",
					EPIC_NAME: "",
					IS_LAST_SPEC: "false",
				},
				cwd,
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
				type: "build",
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
		status = updateSpecStatus(status, found.name, "building");
		writeStatus(status, cwd);
		throw new AbortError(found.name, loopResult.iterations.length);
	}

	const totalIterations = loopResult.iterations.length;
	const totalTokens = loopResult.iterations.reduce((sum, r) => sum + (r.tokensUsed ?? 0), 0);

	const prd = readPrd(found.name, cwd);
	let taskCount = 0;
	let allTasksDone = false;
	let remainingTasks = 0;
	if (prd) {
		const taskSummary = getTaskSummary(prd);
		taskCount = Object.values(taskSummary).reduce((a, b) => a + b, 0);
		allTasksDone = taskSummary.done === taskCount && taskCount > 0;
		remainingTasks = taskCount - taskSummary.done;
	}

	// Handle fatal error during iteration
	if (loopResult.stopReason === "error") {
		status = updateSpecStatus(status, found.name, "building");
		writeStatus(status, cwd);
		const lastIter = loopResult.iterations[loopResult.iterations.length - 1];
		const errorMsg = `Build failed after ${totalIterations} iteration(s). Last exit code: ${lastIter?.exitCode ?? "unknown"}`;
		return { specName: found.name, taskCount, prdPath, totalIterations, totalTokens, specDone: false, error: errorMsg, remainingTasks };
	}

	const specDone = loopResult.stopReason === "sentinel" || allTasksDone;
	status = updateSpecStatus(status, found.name, specDone ? "done" : "building");
	writeStatus(status, cwd);

	return { specName: found.name, taskCount, prdPath, totalIterations, totalTokens, specDone, remainingTasks: specDone ? 0 : remainingTasks };
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
 * Uses PROMPT_BUILD_ALL template. IS_LAST_SPEC is 'true' only for the final spec.
 */
export async function executeBuildAll(
	flags: BuildFlags,
	callbacks: BuildAllCallbacks = {},
	cwd: string = process.cwd(),
	abortSignal?: AbortSignal,
): Promise<BuildAllResult> {
	ensureLocalDir(cwd);

	const config = loadConfig(cwd);
	const specs = discoverSpecs(cwd, config);

	if (specs.length === 0) {
		throw new Error("No specs found in specs/");
	}

	const planned = sortSpecs([...filterByStatus(specs, "planned"), ...filterByStatus(specs, "building")]);
	if (planned.length === 0) {
		throw new Error("No planned specs found. Run 'toby plan' first.");
	}

	const skipped = specs.filter((s) => s.status !== "planned" && s.status !== "building").map((s) => s.name);
	const built: BuildResult[] = [];

	for (let i = 0; i < planned.length; i++) {
		const spec = planned[i];
		const isLastSpec = i === planned.length - 1;
		callbacks.onSpecStart?.(spec.name, i, planned.length);

		if (!hasPrd(spec.name, cwd)) {
			throw new Error(`No plan found for ${spec.name}. Run 'toby plan --spec=${spec.name}' first.`);
		}

		const specWithContent = loadSpecContent(spec);
		const prdPath = getPrdPath(spec.name, cwd);
		const commandConfig = resolveCommandConfig(config, "build", {
			cli: flags.cli as "claude" | "codex" | "opencode" | undefined,
			iterations: flags.iterations,
		});

		let status = readStatus(cwd);

		let iterationStartTime = new Date().toISOString();
		callbacks.onPhase?.("building");
		callbacks.onIteration?.(1, commandConfig.iterations);

		const loopResult = await runLoop({
			maxIterations: commandConfig.iterations,
			getPrompt: (iteration) =>
				loadPrompt(
					"PROMPT_BUILD_ALL",
					{
						SPEC_NAME: spec.name,
						ITERATION: String(iteration),
						SPEC_CONTENT: specWithContent.content ?? "",
						PRD_PATH: prdPath,
						BRANCH: "",
						WORKTREE: "",
						EPIC_NAME: "",
						IS_LAST_SPEC: isLastSpec ? "true" : "false",
					},
					cwd,
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
					type: "build",
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
				status = addIteration(status, spec.name, iteration);
				writeStatus(status, cwd);
				callbacks.onIteration?.(iterResult.iteration + 1, commandConfig.iterations);
			},
		});

		if (loopResult.stopReason === "aborted") {
			status = updateSpecStatus(status, spec.name, "building");
			writeStatus(status, cwd);
			throw new AbortError(spec.name, loopResult.iterations.length);
		}

		const totalIterations = loopResult.iterations.length;
		const totalTokens = loopResult.iterations.reduce((sum, r) => sum + (r.tokensUsed ?? 0), 0);

		const prd = readPrd(spec.name, cwd);
		let taskCount = 0;
		let allTasksDone = false;
		if (prd) {
			const taskSummary = getTaskSummary(prd);
			taskCount = Object.values(taskSummary).reduce((a, b) => a + b, 0);
			allTasksDone = taskSummary.done === taskCount && taskCount > 0;
		}

		const specDone = loopResult.stopReason === "sentinel" || allTasksDone;
		status = updateSpecStatus(status, spec.name, specDone ? "done" : "building");
		writeStatus(status, cwd);

		const result: BuildResult = { specName: spec.name, taskCount, prdPath, totalIterations, totalTokens, specDone };
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
		return <SpecSelector specs={runner.specs} onSelect={runner.handleSpecSelect} title="Select a spec to build:" />;
	}

	if (runner.phase === "done" && allResult) {
		const totalIter = allResult.built.reduce((s, r) => s + r.totalIterations, 0);
		const totalTok = allResult.built.reduce((s, r) => s + r.totalTokens, 0);
		return (
			<Box flexDirection="column">
				<Text color="green">{`✓ All specs built (${allResult.built.length} built, ${allResult.skipped.length} skipped)`}</Text>
				{allResult.built.map((r) => (
					<Text key={r.specName}>{`  ${r.specName}: ${r.taskCount} tasks, ${r.totalIterations} iterations, ${r.totalTokens} tokens${r.specDone ? " [done]" : ""}`}</Text>
				))}
				<Text dimColor>{`  Total: ${totalIter} iterations, ${totalTok} tokens`}</Text>
				{allResult.skipped.length > 0 && (
					<Text dimColor>{`  Skipped: ${allResult.skipped.join(", ")}`}</Text>
				)}
			</Box>
		);
	}

	if (runner.phase === "done" && result) {
		if (result.taskCount === 0 && result.totalIterations === 0) {
			return <Text color="yellow">{`No tasks found in ${result.specName} — nothing to build`}</Text>;
		}
		if (result.specDone && result.totalIterations === 0) {
			return <Text color="green">{`✓ All tasks already complete for ${result.specName}`}</Text>;
		}
		if (result.error) {
			return (
				<Box flexDirection="column">
					<Text color="red">{`✗ ${result.error}`}</Text>
					{(result.remainingTasks ?? 0) > 0 && (
						<Text dimColor>{`  ${result.remainingTasks} task(s) remaining`}</Text>
					)}
				</Box>
			);
		}
		return (
			<Box flexDirection="column">
				<Text color="green">{`✓ Build ${result.specDone ? "complete" : "paused"} for ${result.specName}`}</Text>
				<Text>{`  Tasks: ${result.taskCount}, Iterations: ${result.totalIterations}, Tokens: ${result.totalTokens}`}</Text>
				{!result.specDone && (result.remainingTasks ?? 0) > 0 && (
					<Text dimColor>{`  ${result.remainingTasks} task(s) remaining (max iterations reached)`}</Text>
				)}
				<Text>{`  PRD: ${result.prdPath}`}</Text>
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
