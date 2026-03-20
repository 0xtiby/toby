import React, { useState, useEffect, useRef } from "react";
import { Text, Box, useApp } from "ink";
import type { CliEvent } from "@0xtiby/spawner";
import { loadConfig, resolveCommandConfig } from "../lib/config.js";
import { discoverSpecs, filterByStatus, findSpec, loadSpecContent } from "../lib/specs.js";
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

export interface PlanFlags {
	spec?: string;
	all: boolean;
	iterations?: number;
	verbose: boolean;
	cli?: string;
}

export interface PlanCallbacks {
	onPhase?: (phase: string) => void;
	onIteration?: (current: number, max: number) => void;
	onEvent?: (event: CliEvent) => void;
	onRefinement?: (specName: string, taskCount: number) => void;
}

export interface PlanResult {
	specName: string;
	taskCount: number;
	prdPath: string;
}

export class AbortError extends Error {
	specName: string;
	completedIterations: number;
	constructor(specName: string, completedIterations: number) {
		super(`Planning interrupted for ${specName} after ${completedIterations} iteration(s)`);
		this.name = "AbortError";
		this.specName = specName;
		this.completedIterations = completedIterations;
	}
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
	const prdPath = getPrdPath(found.name, cwd);

	// Detect refinement mode: existing prd.json means we're refining
	let status = readStatus(cwd);
	const specStatus = status.specs[found.name];
	const existingIterations = specStatus?.iterations.length ?? 0;
	const isRefinement = hasPrd(found.name, cwd);

	if (isRefinement) {
		const existingPrd = readPrd(found.name, cwd);
		const taskCount = existingPrd
			? Object.values(getTaskSummary(existingPrd)).reduce((a, b) => a + b, 0)
			: 0;
		callbacks.onRefinement?.(found.name, taskCount);
	}

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
					PRD_PATH: prdPath,
					BRANCH: "",
					WORKTREE: "",
					EPIC_NAME: "",
					IS_LAST_SPEC: "",
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
				type: "plan",
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
		status = updateSpecStatus(status, found.name, "planned");
		writeStatus(status, cwd);
		throw new AbortError(found.name, loopResult.iterations.length);
	}

	status = updateSpecStatus(status, found.name, "planned");
	writeStatus(status, cwd);

	const prd = readPrd(found.name, cwd);
	let taskCount = 0;
	if (prd) {
		const taskSummary = getTaskSummary(prd);
		taskCount = Object.values(taskSummary).reduce((a, b) => a + b, 0);
	}

	return { specName: found.name, taskCount, prdPath };
}

export interface PlanAllCallbacks {
	onSpecStart?: (specName: string, index: number, total: number) => void;
	onSpecComplete?: (result: PlanResult) => void;
	onPhase?: (phase: string) => void;
	onIteration?: (current: number, max: number) => void;
	onEvent?: (event: CliEvent) => void;
	onRefinement?: (specName: string, taskCount: number) => void;
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

function getInitialPhase(flags: PlanFlags): "init" | "all" | "selecting" {
	if (flags.all) return "all";
	if (flags.spec) return "init";
	return "selecting";
}

export default function Plan(flags: PlanFlags) {
	const { exit } = useApp();
	const [phase, setPhase] = useState<"init" | "all" | "selecting" | "planning" | "done" | "interrupted" | "error">(
		getInitialPhase(flags),
	);
	const [currentIteration, setCurrentIteration] = useState(0);
	const [maxIterations, setMaxIterations] = useState(0);
	const [specName, setSpecName] = useState("");
	const [events, setEvents] = useState<CliEvent[]>([]);
	const [errorMessage, setErrorMessage] = useState("");
	const [result, setResult] = useState<PlanResult | null>(null);
	const [allResult, setAllResult] = useState<PlanAllResult | null>(null);
	const [specs, setSpecs] = useState<Spec[]>([]);
	const [activeFlags, setActiveFlags] = useState<PlanFlags>(flags);
	const [refinementInfo, setRefinementInfo] = useState<{ specName: string; taskCount: number } | null>(null);
	const [allProgress, setAllProgress] = useState<{ current: number; total: number }>({ current: 0, total: 0 });
	const [interruptInfo, setInterruptInfo] = useState<{ specName: string; iterations: number } | null>(null);
	const abortControllerRef = useRef(new AbortController());

	// Wire SIGINT to abort the planning loop
	useEffect(() => {
		const handler = () => { abortControllerRef.current.abort(); };
		process.on("SIGINT", handler);
		return () => { process.off("SIGINT", handler); };
	}, []);

	// Resolve verbose: --verbose flag overrides config.verbose
	const resolvedVerbose = flags.verbose || (() => {
		try { return loadConfig().verbose; } catch { return false; }
	})();

	// Discover specs for the selector when no --spec flag
	useEffect(() => {
		if (phase !== "selecting") return;
		try {
			const config = loadConfig();
			const discovered = discoverSpecs(process.cwd(), config);
			setSpecs(discovered);
		} catch (err) {
			setErrorMessage((err as Error).message);
			setPhase("error");
			exit(new Error((err as Error).message));
		}
	}, [phase]);

	// Run --all mode
	useEffect(() => {
		if (phase !== "all") return;
		executePlanAll(flags, {
			onSpecStart: (name, index, total) => {
				setSpecName(name);
				setAllProgress({ current: index + 1, total });
			},
			onSpecComplete: () => {},
			onPhase: (p) => { if (p === "planning") setPhase("planning"); },
			onRefinement: (name, count) => { setRefinementInfo({ specName: name, taskCount: count }); },
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

	// Run planning when we have a spec (single mode)
	useEffect(() => {
		if (phase !== "init") return;
		executePlan(activeFlags, {
			onPhase: (p) => { if (p === "planning") setPhase("planning"); },
			onRefinement: (name, count) => { setRefinementInfo({ specName: name, taskCount: count }); },
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
				<Text color="yellow">{`⚠ Planning interrupted for ${interruptInfo.specName}`}</Text>
				<Text dimColor>{`  ${interruptInfo.iterations} iteration(s) completed, partial status saved`}</Text>
			</Box>
		);
	}

	if (phase === "error") {
		return <Text color="red">{errorMessage}</Text>;
	}

	if (phase === "selecting") {
		return <SpecSelector specs={specs} onSelect={handleSpecSelect} />;
	}

	if (phase === "done" && allResult) {
		return (
			<Box flexDirection="column">
				<Text color="green">{`✓ All specs planned (${allResult.planned.length} planned, ${allResult.skipped.length} skipped)`}</Text>
				{allResult.planned.map((r) => (
					<Text key={r.specName}>{`  ${r.specName}: ${r.taskCount} tasks`}</Text>
				))}
				{allResult.skipped.length > 0 && (
					<Text dimColor>{`  Skipped: ${allResult.skipped.join(", ")}`}</Text>
				)}
			</Box>
		);
	}

	if (phase === "done" && result) {
		return (
			<Box flexDirection="column">
				<Text color="green">{`✓ Plan complete for ${result.specName}`}</Text>
				<Text>{`  Tasks created: ${result.taskCount}`}</Text>
				<Text>{`  PRD: ${result.prdPath}`}</Text>
			</Box>
		);
	}

	return (
		<Box flexDirection="column">
			{refinementInfo && (
				<>
					<Text color="yellow">{`Existing plan found for ${refinementInfo.specName} (${refinementInfo.taskCount} tasks)`}</Text>
					<Text color="yellow">Running in refinement mode...</Text>
				</>
			)}
			{allProgress.total > 0 && (
				<Text dimColor>{`[${allProgress.current}/${allProgress.total}]`}</Text>
			)}
			<Text dimColor>
				{`Planning: ${specName || activeFlags.spec} (iteration ${Math.min(currentIteration, maxIterations)}/${maxIterations})`}
			</Text>
			<Text dimColor>{"─".repeat(40)}</Text>
			<StreamOutput events={events} verbose={resolvedVerbose} />
		</Box>
	);
}
