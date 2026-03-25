import React, { useState, useEffect, useMemo } from "react";
import { Text, useApp, useInput } from "ink";
import { listTranscripts, deleteTranscripts } from "../lib/clean.js";

interface CleanProps {
	force?: boolean;
}

export interface CleanResult {
	deleted: number;
	failed: number;
	total: number;
}

export function executeClean(cwd?: string): CleanResult {
	const files = listTranscripts(cwd);
	if (files.length === 0) {
		return { deleted: 0, failed: 0, total: 0 };
	}
	const deleted = deleteTranscripts(files);
	return { deleted, failed: files.length - deleted, total: files.length };
}

type CleanPhase = "empty" | "error" | "confirming" | "done" | "cancelled";

function computeInitial(force?: boolean): { phase: CleanPhase; fileCount: number; result: CleanResult | null } {
	const files = listTranscripts();
	if (files.length === 0) {
		return { phase: "empty", fileCount: 0, result: null };
	}

	if (!process.stdin.isTTY && !force) {
		process.exitCode = 1;
		return { phase: "error", fileCount: files.length, result: null };
	}

	if (force) {
		const r = executeClean();
		return { phase: "done", fileCount: files.length, result: r };
	}

	return { phase: "confirming", fileCount: files.length, result: null };
}

export default function Clean({ force }: CleanProps) {
	const { exit } = useApp();
	const initial = useMemo(() => computeInitial(force), [force]);
	const [phase, setPhase] = useState<CleanPhase>(initial.phase);
	const [result, setResult] = useState<CleanResult | null>(initial.result);

	useEffect(() => {
		if (phase === "empty" || phase === "done" || phase === "cancelled" || phase === "error") {
			const timer = setTimeout(() => exit(), 100);
			return () => clearTimeout(timer);
		}
	}, [phase, exit]);

	useInput((input, key) => {
		if (phase !== "confirming") return;

		if (input === "y" || key.return) {
			const r = executeClean();
			setResult(r);
			setPhase("done");
		} else if (input === "n" || key.escape) {
			setPhase("cancelled");
		}
	});

	if (phase === "error") {
		return <Text color="red">Error: Use --force to clean transcripts in non-interactive mode.</Text>;
	}

	if (phase === "empty") {
		return <Text>No transcripts to clean.</Text>;
	}

	if (phase === "confirming") {
		return <Text>Found {initial.fileCount} transcript files. Delete all? [Y/n]</Text>;
	}

	if (phase === "done" && result) {
		if (result.failed > 0) {
			return (
				<Text>
					Deleted {result.deleted} transcript files. Failed to delete {result.failed} files.
				</Text>
			);
		}
		return <Text>Deleted {result.deleted} transcript files.</Text>;
	}

	if (phase === "cancelled") {
		return <Text>Clean cancelled.</Text>;
	}

	return null;
}
