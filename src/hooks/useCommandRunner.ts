import { useState, useEffect, useRef, useMemo } from "react";
import { useApp } from "ink";
import type { CliEvent } from "@0xtiby/spawner";
import { loadConfig } from "../lib/config.js";
import { discoverSpecs } from "../lib/specs.js";
import type { Spec } from "../lib/specs.js";
import { AbortError } from "../lib/errors.js";

export interface CommandFlags {
	spec?: string;
	all: boolean;
	iterations?: number;
	verbose: boolean;
	cli?: string;
}

export type Phase = "init" | "all" | "selecting" | "running" | "done" | "interrupted" | "error";

const MAX_EVENTS = 100;

export function useCommandRunner(options: {
	flags: CommandFlags;
	runPhase: string;
	filterSpecs?: (specs: Spec[]) => Spec[];
	emptyMessage?: string;
}) {
	const { flags, runPhase, filterSpecs, emptyMessage } = options;
	const { exit } = useApp();

	const [phase, setPhase] = useState<Phase>(() => {
		if (flags.all) return "all";
		if (flags.spec) return "init";
		return "selecting";
	});
	const [currentIteration, setCurrentIteration] = useState(0);
	const [maxIterations, setMaxIterations] = useState(0);
	const [specName, setSpecName] = useState("");
	const [events, setEvents] = useState<CliEvent[]>([]);
	const [errorMessage, setErrorMessage] = useState("");
	const [specs, setSpecs] = useState<Spec[]>([]);
	const [activeFlags, setActiveFlags] = useState<CommandFlags>(flags);
	const [allProgress, setAllProgress] = useState({ current: 0, total: 0 });
	const [interruptInfo, setInterruptInfo] = useState<{ specName: string; iterations: number } | null>(null);
	const abortControllerRef = useRef(new AbortController());

	// Wire SIGINT to abort
	useEffect(() => {
		const handler = () => { abortControllerRef.current.abort(); };
		process.on("SIGINT", handler);
		return () => { process.off("SIGINT", handler); };
	}, []);

	// Memoize verbose resolution to avoid re-reading config on every render
	const resolvedVerbose = useMemo(() => {
		if (flags.verbose) return true;
		try { return loadConfig().verbose; } catch { return false; }
	}, [flags.verbose]);

	// Discover specs for the selector
	useEffect(() => {
		if (phase !== "selecting") return;
		try {
			const config = loadConfig();
			const discovered = discoverSpecs(process.cwd(), config);
			const filtered = filterSpecs ? filterSpecs(discovered) : discovered;
			if (filtered.length === 0) {
				setErrorMessage(emptyMessage ?? "No specs found.");
				setPhase("error");
				return;
			}
			setSpecs(filtered);
		} catch (err) {
			setErrorMessage((err as Error).message);
			setPhase("error");
			exit(new Error((err as Error).message));
		}
	}, [phase]);

	// Bounded event buffer
	function addEvent(event: CliEvent) {
		setEvents((prev) =>
			prev.length >= MAX_EVENTS
				? [...prev.slice(-MAX_EVENTS + 1), event]
				: [...prev, event]
		);
	}

	function handleSpecSelect(spec: Spec) {
		setActiveFlags({ ...flags, spec: spec.name });
		setPhase("init");
	}

	function handleError(err: unknown) {
		if (err instanceof AbortError) {
			setInterruptInfo({ specName: err.specName, iterations: err.completedIterations });
			setPhase("interrupted");
			exit();
			return;
		}
		setErrorMessage((err as Error).message);
		setPhase("error");
		exit(new Error((err as Error).message));
	}

	function handleDone() {
		setPhase("done");
		exit();
	}

	function onPhaseCallback(p: string) {
		if (p === runPhase) setPhase("running");
	}

	function onIterationCallback(current: number, max: number) {
		setCurrentIteration(current);
		setMaxIterations(max);
	}

	function onSpecStartCallback(name: string, index: number, total: number) {
		setSpecName(name);
		setAllProgress({ current: index + 1, total });
	}

	return {
		phase,
		currentIteration,
		maxIterations,
		specName, setSpecName,
		events, addEvent,
		errorMessage,
		specs,
		activeFlags,
		allProgress,
		interruptInfo,
		abortSignal: abortControllerRef.current.signal,
		resolvedVerbose,
		handleSpecSelect,
		handleError,
		handleDone,
		onPhaseCallback,
		onIterationCallback,
		onSpecStartCallback,
	};
}
