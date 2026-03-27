import React, { useState, useEffect, useRef } from "react";
import { Box, Text, useApp } from "ink";
import { loadConfig, resolveCommandConfig } from "../lib/config.js";
import { discoverSpecs, findSpec } from "../lib/specs.js";
import { readStatus, updateSessionState, hasResumableSession, writeStatus } from "../lib/status.js";
import { executeBuildAll } from "./build.js";
import type { BuildFlags } from "./build.js";
import type { BuildAllCallbacks, BuildAllResult } from "./build.js";

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

type ResumePhase = "loading" | "building" | "done" | "error";

export default function Resume(props: ResumeFlags) {
	const { exit } = useApp();
	const [phase, setPhase] = useState<ResumePhase>("loading");
	const [messages, setMessages] = useState<string[]>([]);
	const [result, setResult] = useState<BuildAllResult | null>(null);
	const [errorMessage, setErrorMessage] = useState("");
	const abortController = useRef(new AbortController());

	useEffect(() => {
		const callbacks: BuildAllCallbacks = {
			onOutput: (msg) => setMessages((prev) => [...prev, msg]),
		};

		setPhase("building");
		executeResume(props, callbacks, undefined, abortController.current.signal)
			.then((r) => {
				setResult(r);
				setPhase("done");
			})
			.catch((err: Error) => {
				if (abortController.current.signal.aborted) return;
				setErrorMessage(err.message);
				setPhase("error");
			});

		return () => {
			abortController.current.abort();
		};
	}, []);

	useEffect(() => {
		if (phase === "done" || phase === "error") {
			const timer = setTimeout(() => exit(), 100);
			return () => clearTimeout(timer);
		}
	}, [phase, exit]);

	if (phase === "error") {
		return <Text color="red">{errorMessage}</Text>;
	}

	if (phase === "done" && result) {
		const totalIter = result.built.reduce((s, r) => s + r.totalIterations, 0);
		const totalTok = result.built.reduce((s, r) => s + r.totalTokens, 0);
		return (
			<Box flexDirection="column">
				{messages.map((msg, i) => (
					<Text key={i} dimColor>{msg}</Text>
				))}
				<Text color="green">{`✓ Resume complete (${result.built.length} spec(s) built)`}</Text>
				{result.built.map((r) => (
					<Text key={r.specName} color={r.stopReason === "max_iterations" ? "yellow" : undefined}>
						{r.stopReason === "max_iterations"
							? `  ⚠️ ${r.specName}: max iteration limit reached (${r.totalIterations}/${r.maxIterations})`
							: `  ${r.specName}: ${r.totalIterations} iterations, ${r.totalTokens} tokens${r.specDone ? " [done]" : ""}`}
					</Text>
				))}
				<Text dimColor>{`  Total: ${totalIter} iterations, ${totalTok} tokens`}</Text>
			</Box>
		);
	}

	return (
		<Box flexDirection="column">
			{messages.map((msg, i) => (
				<Text key={i} dimColor>{msg}</Text>
			))}
			<Text dimColor>Resuming build...</Text>
		</Box>
	);
}
