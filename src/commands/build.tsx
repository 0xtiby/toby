import React, { useState, useEffect, useRef } from "react";
import { Text, Box, useApp } from "ink";
import type { CliEvent } from "@0xtiby/spawner";
import { loadConfig, resolveCommandConfig } from "../lib/config.js";
import { discoverSpecs, filterByStatus, findSpec, loadSpecContent, sortSpecs } from "../lib/specs.js";
import type { Spec } from "../lib/specs.js";
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
import SpecSelector from "../components/SpecSelector.js";
import StreamOutput from "../components/StreamOutput.js";

export interface BuildFlags {
	spec?: string;
	all: boolean;
	iterations?: number;
	verbose: boolean;
	cli?: string;
}

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
	/** Set when build stopped early due to an error */
	error?: string;
	/** Number of incomplete tasks remaining */
	remainingTasks?: number;
}

export class AbortError extends Error {
	specName: string;
	completedIterations: number;
	constructor(specName: string, completedIterations: number) {
		super(`Building interrupted for ${specName} after ${completedIterations} iteration(s)`);
		this.name = "AbortError";
		this.specName = specName;
		this.completedIterations = completedIterations;
	}
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
			const now = new Date().toISOString();
			const iteration: Iteration = {
				type: "build",
				iteration: iterResult.iteration,
				sessionId: iterResult.sessionId,
				cli: commandConfig.cli,
				model: iterResult.model ?? commandConfig.model,
				startedAt: now,
				completedAt: now,
				exitCode: iterResult.exitCode,
				taskCompleted: null,
				tokensUsed: iterResult.tokensUsed,
			};
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
				const now = new Date().toISOString();
				const iteration: Iteration = {
					type: "build",
					iteration: iterResult.iteration,
					sessionId: iterResult.sessionId,
					cli: commandConfig.cli,
					model: iterResult.model ?? commandConfig.model,
					startedAt: now,
					completedAt: now,
					exitCode: iterResult.exitCode,
					taskCompleted: null,
					tokensUsed: iterResult.tokensUsed,
				};
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

function getInitialPhase(flags: BuildFlags): "init" | "all" | "selecting" {
	if (flags.all) return "all";
	if (flags.spec) return "init";
	return "selecting";
}

export default function Build(flags: BuildFlags) {
	const { exit } = useApp();
	const [phase, setPhase] = useState<"init" | "all" | "selecting" | "building" | "done" | "interrupted" | "error">(
		getInitialPhase(flags),
	);
	const [currentIteration, setCurrentIteration] = useState(0);
	const [maxIterations, setMaxIterations] = useState(0);
	const [specName, setSpecName] = useState("");
	const [events, setEvents] = useState<CliEvent[]>([]);
	const [errorMessage, setErrorMessage] = useState("");
	const [result, setResult] = useState<BuildResult | null>(null);
	const [allResult, setAllResult] = useState<BuildAllResult | null>(null);
	const [specs, setSpecs] = useState<Spec[]>([]);
	const [activeFlags, setActiveFlags] = useState<BuildFlags>(flags);
	const [allProgress, setAllProgress] = useState<{ current: number; total: number }>({ current: 0, total: 0 });
	const [interruptInfo, setInterruptInfo] = useState<{ specName: string; iterations: number } | null>(null);
	const abortControllerRef = useRef(new AbortController());

	// Wire SIGINT to abort the build loop
	useEffect(() => {
		const handler = () => { abortControllerRef.current.abort(); };
		process.on("SIGINT", handler);
		return () => { process.off("SIGINT", handler); };
	}, []);

	// Discover specs for the selector when no --spec flag
	useEffect(() => {
		if (phase !== "selecting") return;
		try {
			const config = loadConfig();
			const discovered = discoverSpecs(process.cwd(), config);
			const buildable = [...filterByStatus(discovered, "planned"), ...filterByStatus(discovered, "building")];
			if (buildable.length === 0) {
				setErrorMessage("No planned specs found. Run 'toby plan' first.");
				setPhase("error");
				return;
			}
			setSpecs(buildable);
		} catch (err) {
			setErrorMessage((err as Error).message);
			setPhase("error");
			exit(new Error((err as Error).message));
		}
	}, [phase]);

	// Run --all mode
	useEffect(() => {
		if (phase !== "all") return;
		executeBuildAll(flags, {
			onSpecStart: (name, index, total) => {
				setSpecName(name);
				setAllProgress({ current: index + 1, total });
			},
			onSpecComplete: () => {},
			onPhase: (p) => { if (p === "building") setPhase("building"); },
			onIteration: (current, max) => {
				setCurrentIteration(current);
				setMaxIterations(max);
			},
			onEvent: (event) => {
				setEvents((prev) => [...prev, event]);
			},
		}, undefined, abortControllerRef.current.signal)
			.then((r) => {
				setAllResult(r);
				setPhase("done");
				exit();
			})
			.catch((err) => {
				if (err instanceof AbortError) {
					setInterruptInfo({ specName: err.specName, iterations: err.completedIterations });
					setPhase("interrupted");
					exit();
					return;
				}
				setErrorMessage((err as Error).message);
				setPhase("error");
				exit(new Error((err as Error).message));
			});
	}, [phase]);

	// Resolve verbose: --verbose flag overrides config.verbose
	const resolvedVerbose = flags.verbose || (() => {
		try { return loadConfig().verbose; } catch { return false; }
	})();

	// Run build when we have a spec
	useEffect(() => {
		if (phase !== "init") return;
		executeBuild(activeFlags, {
			onPhase: (p) => { if (p === "building") setPhase("building"); },
			onIteration: (current, max) => {
				setCurrentIteration(current);
				setMaxIterations(max);
			},
			onEvent: (event) => {
				setEvents((prev) => [...prev, event]);
			},
		}, undefined, abortControllerRef.current.signal)
			.then((r) => {
				setSpecName(r.specName);
				setResult(r);
				setPhase("done");
				exit();
			})
			.catch((err) => {
				if (err instanceof AbortError) {
					setInterruptInfo({ specName: err.specName, iterations: err.completedIterations });
					setPhase("interrupted");
					exit();
					return;
				}
				setErrorMessage((err as Error).message);
				setPhase("error");
				exit(new Error((err as Error).message));
			});
	}, [activeFlags, phase]);

	function handleSpecSelect(spec: Spec) {
		const newFlags = { ...flags, spec: spec.name };
		setActiveFlags(newFlags);
		setPhase("init");
	}

	if (phase === "interrupted" && interruptInfo) {
		return (
			<Box flexDirection="column">
				<Text color="yellow">{`⚠ Building interrupted for ${interruptInfo.specName}`}</Text>
				<Text dimColor>{`  ${interruptInfo.iterations} iteration(s) completed, partial status saved`}</Text>
			</Box>
		);
	}

	if (phase === "error") {
		return <Text color="red">{errorMessage}</Text>;
	}

	if (phase === "selecting") {
		if (specs.length === 0) {
			return <Text dimColor>Loading specs...</Text>;
		}
		return <SpecSelector specs={specs} onSelect={handleSpecSelect} title="Select a spec to build:" />;
	}

	if (phase === "done" && allResult) {
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

	if (phase === "done" && result) {
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
			{allProgress.total > 0 && (
				<Text dimColor>{`[${allProgress.current}/${allProgress.total}]`}</Text>
			)}
			<Text dimColor>
				{`Building: ${specName || activeFlags.spec} (iteration ${Math.min(currentIteration, maxIterations)}/${maxIterations})`}
			</Text>
			<Text dimColor>{"─".repeat(40)}</Text>
			<StreamOutput events={events} verbose={resolvedVerbose} />
		</Box>
	);
}
