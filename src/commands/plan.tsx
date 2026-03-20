import React, { useState, useEffect } from "react";
import { Text, Box, useApp } from "ink";
import type { CliEvent } from "@0xtiby/spawner";
import { loadConfig, resolveCommandConfig } from "../lib/config.js";
import { discoverSpecs, findSpec, loadSpecContent } from "../lib/specs.js";
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
import { getPrdPath, readPrd, getTaskSummary } from "../lib/prd.js";
import { ensureLocalDir } from "../lib/paths.js";
import type { Iteration } from "../types.js";
import SpecSelector from "../components/SpecSelector.js";

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
}

export interface PlanResult {
	specName: string;
	taskCount: number;
	prdPath: string;
}

/**
 * Core planning logic, separated from Ink rendering for testability.
 */
export async function executePlan(
	flags: PlanFlags,
	callbacks: PlanCallbacks = {},
	cwd: string = process.cwd(),
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

	callbacks.onPhase?.("planning");
	callbacks.onIteration?.(1, commandConfig.iterations);

	let status = readStatus(cwd);

	await runLoop({
		maxIterations: commandConfig.iterations,
		getPrompt: (iteration) =>
			loadPrompt(
				"PROMPT_PLAN",
				{
					SPEC_NAME: found.name,
					ITERATION: String(iteration),
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

export default function Plan(flags: PlanFlags) {
	const { exit } = useApp();
	const [phase, setPhase] = useState<"init" | "selecting" | "planning" | "done" | "error">(
		flags.spec ? "init" : "selecting",
	);
	const [currentIteration, setCurrentIteration] = useState(0);
	const [maxIterations, setMaxIterations] = useState(0);
	const [specName, setSpecName] = useState("");
	const [lastLine, setLastLine] = useState("");
	const [errorMessage, setErrorMessage] = useState("");
	const [result, setResult] = useState<PlanResult | null>(null);
	const [specs, setSpecs] = useState<Spec[]>([]);
	const [activeFlags, setActiveFlags] = useState<PlanFlags>(flags);

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

	// Run planning when we have a spec
	useEffect(() => {
		if (phase !== "init") return;
		executePlan(activeFlags, {
			onPhase: (p) => { if (p === "planning") setPhase("planning"); },
			onIteration: (current, max) => {
				setCurrentIteration(current);
				setMaxIterations(max);
			},
			onEvent: (event) => {
				if (event.type === "text" && event.content) {
					setLastLine(event.content);
				}
			},
		})
			.then((r) => {
				setSpecName(r.specName);
				setResult(r);
				setPhase("done");
				exit();
			})
			.catch((err) => {
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

	if (phase === "error") {
		return <Text color="red">{errorMessage}</Text>;
	}

	if (phase === "selecting") {
		return <SpecSelector specs={specs} onSelect={handleSpecSelect} />;
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
			<Text dimColor>
				{`Planning: ${specName || activeFlags.spec} (iteration ${Math.min(currentIteration, maxIterations)}/${maxIterations})`}
			</Text>
			<Text dimColor>{"─".repeat(40)}</Text>
			{lastLine && <Text>{lastLine}</Text>}
		</Box>
	);
}
