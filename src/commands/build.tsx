import React, { useState, useEffect, useRef } from "react";
import { Text, Box, useApp } from "ink";
import type { CliEvent } from "@0xtiby/spawner";
import { loadConfig, resolveCommandConfig } from "../lib/config.js";
import { discoverSpecs, findSpec, loadSpecContent } from "../lib/specs.js";
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

	status = updateSpecStatus(status, found.name, "building");
	writeStatus(status, cwd);

	const prd = readPrd(found.name, cwd);
	let taskCount = 0;
	if (prd) {
		const taskSummary = getTaskSummary(prd);
		taskCount = Object.values(taskSummary).reduce((a, b) => a + b, 0);
	}

	return { specName: found.name, taskCount, prdPath };
}

export default function Build(flags: BuildFlags) {
	const { exit } = useApp();
	const [phase, setPhase] = useState<"init" | "building" | "done" | "interrupted" | "error">(
		flags.spec ? "init" : "error",
	);
	const [currentIteration, setCurrentIteration] = useState(0);
	const [maxIterations, setMaxIterations] = useState(0);
	const [specName, setSpecName] = useState("");
	const [events, setEvents] = useState<CliEvent[]>([]);
	const [errorMessage, setErrorMessage] = useState(flags.spec ? "" : "No --spec flag provided. Usage: toby build --spec=<name>");
	const [result, setResult] = useState<BuildResult | null>(null);
	const [interruptInfo, setInterruptInfo] = useState<{ specName: string; iterations: number } | null>(null);
	const abortControllerRef = useRef(new AbortController());

	// Wire SIGINT to abort the build loop
	useEffect(() => {
		const handler = () => { abortControllerRef.current.abort(); };
		process.on("SIGINT", handler);
		return () => { process.off("SIGINT", handler); };
	}, []);

	// Resolve verbose: --verbose flag overrides config.verbose
	const resolvedVerbose = flags.verbose || (() => {
		try { return loadConfig().verbose; } catch { return false; }
	})();

	// Run build when we have a spec
	useEffect(() => {
		if (phase !== "init") return;
		executeBuild(flags, {
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
	}, [phase]);

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

	if (phase === "done" && result) {
		return (
			<Box flexDirection="column">
				<Text color="green">{`✓ Build complete for ${result.specName}`}</Text>
				<Text>{`  Tasks: ${result.taskCount}`}</Text>
				<Text>{`  PRD: ${result.prdPath}`}</Text>
			</Box>
		);
	}

	return (
		<Box flexDirection="column">
			<Text dimColor>
				{`Building: ${specName || flags.spec} (iteration ${Math.min(currentIteration, maxIterations)}/${maxIterations})`}
			</Text>
			<Text dimColor>{"─".repeat(40)}</Text>
			<StreamOutput events={events} verbose={resolvedVerbose} />
		</Box>
	);
}
