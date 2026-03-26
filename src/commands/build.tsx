import React, { useState, useEffect, useMemo } from "react";
import { Text, Box } from "ink";
import type { CliEvent } from "@0xtiby/spawner";
import { loadConfig, resolveCommandConfig } from "../lib/config.js";
import { discoverSpecs, filterByStatus, findSpec, sortSpecs } from "../lib/specs.js";
import type { Spec } from "../lib/specs.js";
import { loadPrompt, computeCliVars, resolveTemplateVars, computeSpecSlug, generateSessionName } from "../lib/template.js";
import { runLoop } from "../lib/loop.js";
import type { IterationResult } from "../lib/loop.js";
import {
	readStatus,
	writeStatus,
	addIteration,
	updateSpecStatus,
	createSession,
	clearSession,
	updateSessionState,
} from "../lib/status.js";
import { ensureLocalDir } from "../lib/paths.js";
import type { CliName, Iteration, IterationState, TemplateVars, PromptName, StatusData, SpecFile, SpecStatusEntry } from "../types.js";
import { AbortError } from "../lib/errors.js";
import { withTranscript } from "../lib/transcript.js";
import type { TranscriptWriter } from "../lib/transcript.js";
import { useCommandRunner } from "../hooks/useCommandRunner.js";
import type { CommandFlags } from "../hooks/useCommandRunner.js";
import MultiSpecSelector from "../components/MultiSpecSelector.js";
import StreamOutput from "../components/StreamOutput.js";

export type BuildFlags = CommandFlags;

export interface BuildCallbacks {
	onPhase?: (phase: string) => void;
	onIteration?: (current: number, max: number) => void;
	onEvent?: (event: CliEvent) => void;
	onOutput?: (message: string) => void;
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
	cli: CliName;
	model?: string;
	templateVars: TemplateVars;
	specsDir: string;
	session: string;
	sessionId?: string;
	specIndex: number;
	specCount: number;
	specs: string[];
	cwd: string;
	abortSignal?: AbortSignal;
	callbacks: BuildCallbacks;
	writer?: TranscriptWriter | null;
}

/**
 * Resolve the sessionId for conversation continuity when resuming a spec.
 * Returns the last iteration's sessionId if the CLI matches, undefined otherwise.
 */
export function resolveResumeSessionId(
	specEntry: SpecStatusEntry | undefined,
	currentCli: string,
	sessionCli: string,
): string | undefined {
	if (currentCli !== sessionCli) return undefined;
	const lastIteration = specEntry?.iterations.at(-1);
	return lastIteration?.sessionId ?? undefined;
}

async function runSpecBuild(options: RunSpecBuildOptions): Promise<{ result: BuildResult; status: StatusData }> {
	const { spec, iterations, cli, model, cwd, callbacks } = options;
	let status = readStatus(cwd);
	let iterationStartTime = new Date().toISOString();

	callbacks.onPhase?.("building");
	callbacks.onIteration?.(1, iterations);

	const loopResult = await runLoop({
		maxIterations: iterations,
		getPrompt: (iteration) => {
			const cliVars = computeCliVars({
				specName: spec.name,
				iteration: iteration + options.existingIterations,
				specIndex: options.specIndex,
				specCount: options.specCount,
				session: options.session,
				specs: options.specs,
				specsDir: options.specsDir,
			});
			const vars = resolveTemplateVars(cliVars, options.templateVars);
			return loadPrompt(options.promptName, vars, { cwd });
		},
		cli,
		model,
		cwd,
		sessionId: options.sessionId,
		continueSession: true,
		abortSignal: options.abortSignal,
		onEvent: (event) => {
			options.writer?.writeEvent(event);
			callbacks.onEvent?.(event);
		},
		onIterationStart: (iteration: number, sessionId: string | null) => {
			iterationStartTime = new Date().toISOString();
			const iterationRecord: Iteration = {
				type: "build",
				iteration: iteration + options.existingIterations,
				sessionId,
				state: "in_progress" as IterationState,
				cli,
				model: model ?? "default",
				startedAt: iterationStartTime,
				completedAt: null,
				exitCode: null,
				taskCompleted: null,
				tokensUsed: null,
			};
			status = addIteration(status, spec.name, iterationRecord);
			writeStatus(status, cwd);
		},
		onIterationComplete: (iterResult: IterationResult) => {
			options.writer?.writeIterationHeader({
				iteration: iterResult.iteration,
				total: iterations,
				cli,
				model: iterResult.model ?? model ?? "default",
			});

			// Determine final state
			const state: IterationState = iterResult.sentinelDetected ? "complete" : "failed";

			// Update the last iteration record (written by onIterationStart)
			const specEntry = status.specs[spec.name];
			const iters = [...specEntry.iterations];
			iters[iters.length - 1] = {
				...iters[iters.length - 1],
				state,
				sessionId: iterResult.sessionId,
				model: iterResult.model ?? iters[iters.length - 1].model,
				completedAt: new Date().toISOString(),
				exitCode: iterResult.exitCode,
				tokensUsed: iterResult.tokensUsed,
			};
			status = {
				...status,
				specs: {
					...status.specs,
					[spec.name]: { ...specEntry, iterations: iters },
				},
			};
			writeStatus(status, cwd);
			callbacks.onIteration?.(iterResult.iteration + 1, iterations);
		},
	});

	// Persist stopReason on spec entry.
	// Note: if aborted, the last iteration remains "in_progress" (since onIterationComplete never ran),
	// so isCrashResume will correctly fire on next run — abort detection relies on iteration state, not stopReason.
	const specEntryAfterLoop = status.specs[spec.name] ?? { status: "building", plannedAt: null, iterations: [] };
	status = {
		...status,
		specs: {
			...status.specs,
			[spec.name]: { ...specEntryAfterLoop, stopReason: loopResult.stopReason },
		},
	};

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
	externalWriter?: TranscriptWriter | null,
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

	let status = readStatus(cwd);
	const specEntry = status.specs[found.name];

	// Done guard: refuse to rebuild a completed spec
	if (specEntry?.status === "done") {
		throw new Error(`Spec '${found.name}' is already done. Reset its status in .toby/status.json to rebuild.`);
	}

	if (!specEntry || (specEntry.status !== "planned" && specEntry.status !== "building")) {
		throw new Error(`No plan found for ${found.name}. Run 'toby plan --spec=${flags.spec}' first.`);
	}

	const existingIterations = specEntry.iterations.length;

	// Session name: reuse existing session name on resume, or compute from spec slug
	const session = flags.session || (status.session?.name) || computeSpecSlug(found.name);

	// Resolve per-spec sessionId for conversation continuity
	const sessionCli = status.session?.cli ?? commandConfig.cli;
	const resumeSessionId = resolveResumeSessionId(specEntry, commandConfig.cli, sessionCli);

	// Create session before first iteration
	if (!status.session) {
		const sessionObj = createSession(session, commandConfig.cli, [found.name]);
		status = { ...status, session: sessionObj };
		writeStatus(status, cwd);
	}

	return withTranscript(
		{ flags, config, command: "build", specName: found.name },
		externalWriter,
		async (writer) => {
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
				sessionId: resumeSessionId,
				specIndex: 1,
				specCount: 1,
				specs: [found.name],
				cwd,
				abortSignal,
				callbacks,
				writer,
			});

			// Session cleanup: clear on success, mark interrupted on failure
			let finalStatus = readStatus(cwd);
			if (result.specDone) {
				finalStatus = clearSession(finalStatus);
			} else {
				finalStatus = updateSessionState(finalStatus, "interrupted");
			}
			writeStatus(finalStatus, cwd);

			return result;
		},
	);
}

export interface BuildAllCallbacks {
	onSpecStart?: (specName: string, index: number, total: number) => void;
	onSpecComplete?: (result: BuildResult) => void;
	onPhase?: (phase: string) => void;
	onIteration?: (current: number, max: number) => void;
	onEvent?: (event: CliEvent) => void;
	onOutput?: (message: string) => void;
}

export interface BuildAllResult {
	built: BuildResult[];
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

	if (specs) {
		// Pre-resolved specs (from multi-spec mode) — use directly
		planned = specs;
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
	}

	const built: BuildResult[] = [];
	const specNames = planned.map((s) => s.name);
	let status = readStatus(cwd);

	// Filter out done specs (silent skip) — buildable is the loop target
	const buildable = planned.filter((spec) => {
		const entry = status.specs[spec.name];
		return entry?.status !== "done";
	});

	// Session name: reuse existing session name on resume, or generate new
	const commandConfig = resolveCommandConfig(config, "build", {
		cli: flags.cli as "claude" | "codex" | "opencode" | undefined,
		iterations: flags.iterations,
	});
	const session = flags.session || (status.session?.name) || generateSessionName();
	const sessionCli = status.session?.cli ?? commandConfig.cli;

	// Session management: create if none exists, reuse if resuming
	const existingSession = status.session;
	if (!existingSession) {
		const sessionObj = createSession(session, commandConfig.cli, specNames);
		status = { ...status, session: sessionObj };
		writeStatus(status, cwd);
	} else {
		// Resume path: session already exists, update state to active
		status = updateSessionState(status, "active");
		writeStatus(status, cwd);
	}
	const sessionObj = status.session!;

	return withTranscript(
		{ flags: { ...flags, session: flags.session ?? session }, config, command: "build" },
		undefined,
		async (writer) => {
			try {
				for (let i = 0; i < buildable.length; i++) {
					const spec = buildable[i];
					// Use planned list for consistent specIndex/specCount across builds and resumes
					const specIndex = planned.indexOf(spec) + 1;
					writer?.writeSpecHeader(specIndex, planned.length, spec.name);
					callbacks.onSpecStart?.(spec.name, specIndex - 1, planned.length);

					// Per-spec sessionId resolution for conversation continuity
					const specEntry = status.specs[spec.name];
					const existingIterations = specEntry?.iterations.length ?? 0;
					const resumeSessionId = resolveResumeSessionId(specEntry, commandConfig.cli, sessionCli);

					const { result } = await runSpecBuild({
						spec,
						promptName: "PROMPT_BUILD",
						existingIterations,
						iterations: commandConfig.iterations,
						cli: commandConfig.cli,
						model: commandConfig.model,
						templateVars: config.templateVars,
						specsDir: config.specsDir,
						session,
						sessionId: resumeSessionId,
						specIndex,
						specCount: planned.length,
						specs: specNames,
						cwd,
						abortSignal,
						callbacks: {
							onPhase: callbacks.onPhase,
							onIteration: callbacks.onIteration,
							onEvent: callbacks.onEvent,
							onOutput: callbacks.onOutput,
						},
						writer,
					});

					built.push(result);
					callbacks.onSpecComplete?.(result);

					// Stop on error: non-sentinel stop breaks the loop
					if (!result.specDone) {
						let currentStatus = readStatus(cwd);
						currentStatus = updateSessionState(currentStatus, "interrupted");
						writeStatus(currentStatus, cwd);

						// Summary output
						const allSpecNames = sessionObj.specs;
						const doneSpecs = allSpecNames.filter((name) => {
							const entry = readStatus(cwd).specs[name];
							return entry?.status === "done";
						});
						const remainingSpecs = allSpecNames.filter((name) => !doneSpecs.includes(name));

						callbacks.onOutput?.(
							`Session "${sessionObj.name}" interrupted at ${spec.name} (${result.error ? "error" : "incomplete"}).`,
						);
						callbacks.onOutput?.(
							`Completed: ${doneSpecs.join(", ") || "none"} (${doneSpecs.length}/${allSpecNames.length})`,
						);
						callbacks.onOutput?.(
							`Remaining: ${remainingSpecs.join(", ")} (${remainingSpecs.length}/${allSpecNames.length})`,
						);
						callbacks.onOutput?.("Run 'toby resume' to continue.");
						break;
					}
				}
			} catch (err) {
				// Handle AbortError (Ctrl+C): set session state before re-throwing
				if (err instanceof AbortError) {
					const currentStatus = readStatus(cwd);
					writeStatus(updateSessionState(currentStatus, "interrupted"), cwd);
				}
				throw err;
			}

			// If all session specs are done, clear session
			const finalStatus = readStatus(cwd);
			const allDone = sessionObj.specs.every((name) => finalStatus.specs[name]?.status === "done");
			if (allDone) {
				writeStatus(clearSession(finalStatus), cwd);
			}

			return { built };
		},
	);
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

	const allCallbacks: BuildAllCallbacks = useMemo(() => ({
		onSpecStart: runner.onSpecStartCallback,
		onSpecComplete: () => {},
		onPhase: runner.onPhaseCallback,
		onIteration: runner.onIterationCallback,
		onEvent: runner.addEvent,
	}), [runner.onSpecStartCallback, runner.onPhaseCallback, runner.onIterationCallback, runner.addEvent]);

	// Run multi-spec mode (specs resolved by useCommandRunner)
	useEffect(() => {
		if (runner.phase !== "multi" || runner.selectedSpecs.length === 0) return;
		executeBuildAll(flags, allCallbacks, undefined, runner.abortSignal, runner.selectedSpecs)
			.then((r) => { setAllResult(r); runner.handleDone(); })
			.catch(runner.handleError);
	}, [runner.phase, runner.selectedSpecs]);

	// Run --all mode
	useEffect(() => {
		if (runner.phase !== "all") return;
		executeBuildAll(flags, allCallbacks, undefined, runner.abortSignal)
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
				<Text color="green">{`✓ All specs built (${allResult.built.length} built)`}</Text>
				{allResult.built.map((r) => (
					<Text key={r.specName}>{`  ${r.specName}: ${r.totalIterations} iterations, ${r.totalTokens} tokens${r.specDone ? " [done]" : ""}`}</Text>
				))}
				<Text dimColor>{`  Total: ${totalIter} iterations, ${totalTok} tokens`}</Text>
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
