import React from "react";
import { Text, Box } from "ink";
import fs from "node:fs";
import { loadConfig } from "../lib/config.js";
import { discoverSpecs, findSpec } from "../lib/specs.js";
import { readStatus, getSpecStatus } from "../lib/status.js";
import { getLocalDir } from "../lib/paths.js";

export interface StatusFlags {
	spec?: string;
	version: string;
}

interface SpecRow {
	name: string;
	status: string;
	tokens: number;
	iterations: number;
}

interface IterationRow {
	index: string;
	type: string;
	cli: string;
	tokens: string;
	duration: string;
	exitCode: string;
}

export function formatDuration(startedAt: string, completedAt: string | null): string {
	if (!completedAt) return "—";
	const ms = new Date(completedAt).getTime() - new Date(startedAt).getTime();
	const seconds = Math.floor(ms / 1000);
	const minutes = Math.floor(seconds / 60);
	const remainingSeconds = seconds % 60;
	return `${minutes}m ${remainingSeconds}s`;
}

function buildRows(cwd: string): { rows: SpecRow[]; warnings: string[] } {
	const config = loadConfig(cwd);
	const specs = discoverSpecs(cwd, config);
	const warnings: string[] = [];

	let statusData;
	try {
		statusData = readStatus(cwd);
	} catch {
		warnings.push("Corrupt status.json — showing defaults. Run toby init to re-create.");
		statusData = { specs: {} } as import("../types.js").StatusData;
	}

	const rows = specs.map((spec) => {
		const entry = getSpecStatus(statusData, spec.name);
		const tokens = entry.iterations.reduce(
			(sum: number, iter: { tokensUsed: number | null }) => sum + (iter.tokensUsed ?? 0),
			0,
		);
		return {
			name: spec.name,
			status: entry.status,
			tokens,
			iterations: entry.iterations.length,
		};
	});

	return { rows, warnings };
}

function pad(str: string, len: number): string {
	return str + " ".repeat(Math.max(0, len - str.length));
}

function StatusTable({ rows }: { rows: SpecRow[] }) {
	const headers = { name: "Spec", status: "Status", iterations: "Iter", tokens: "Tokens" };
	const colWidths = {
		name: Math.max(headers.name.length, ...rows.map((r) => r.name.length)),
		status: Math.max(headers.status.length, ...rows.map((r) => r.status.length)),
		iterations: Math.max(headers.iterations.length, ...rows.map((r) => String(r.iterations).length)),
		tokens: Math.max(headers.tokens.length, ...rows.map((r) => String(r.tokens).length)),
	};

	const separator = `${"─".repeat(colWidths.name + 2)}┼${"─".repeat(colWidths.status + 2)}┼${"─".repeat(colWidths.iterations + 2)}┼${"─".repeat(colWidths.tokens + 2)}`;
	const headerLine = ` ${pad(headers.name, colWidths.name)} │ ${pad(headers.status, colWidths.status)} │ ${pad(headers.iterations, colWidths.iterations)} │ ${pad(headers.tokens, colWidths.tokens)} `;

	return (
		<Box flexDirection="column">
			<Text bold>{headerLine}</Text>
			<Text dimColor>{separator}</Text>
			{rows.map((row) => (
				<Text key={row.name}>
					{` ${pad(row.name, colWidths.name)} │ ${pad(row.status, colWidths.status)} │ ${pad(String(row.iterations), colWidths.iterations)} │ ${pad(String(row.tokens), colWidths.tokens)} `}
				</Text>
			))}
		</Box>
	);
}

function IterationTable({ rows }: { rows: IterationRow[] }) {
	if (rows.length === 0) {
		return <Text dimColor>No iterations yet</Text>;
	}

	const headers = { index: "#", type: "Type", cli: "CLI", tokens: "Tokens", duration: "Duration", exitCode: "Exit" };
	const w = {
		index: Math.max(headers.index.length, ...rows.map((r) => r.index.length)),
		type: Math.max(headers.type.length, ...rows.map((r) => r.type.length)),
		cli: Math.max(headers.cli.length, ...rows.map((r) => r.cli.length)),
		tokens: Math.max(headers.tokens.length, ...rows.map((r) => r.tokens.length)),
		duration: Math.max(headers.duration.length, ...rows.map((r) => r.duration.length)),
		exitCode: Math.max(headers.exitCode.length, ...rows.map((r) => r.exitCode.length)),
	};

	const separator = `${"─".repeat(w.index + 2)}┼${"─".repeat(w.type + 2)}┼${"─".repeat(w.cli + 2)}┼${"─".repeat(w.tokens + 2)}┼${"─".repeat(w.duration + 2)}┼${"─".repeat(w.exitCode + 2)}`;
	const headerLine = ` ${pad(headers.index, w.index)} │ ${pad(headers.type, w.type)} │ ${pad(headers.cli, w.cli)} │ ${pad(headers.tokens, w.tokens)} │ ${pad(headers.duration, w.duration)} │ ${pad(headers.exitCode, w.exitCode)} `;

	return (
		<Box flexDirection="column">
			<Text bold>{headerLine}</Text>
			<Text dimColor>{separator}</Text>
			{rows.map((row) => (
				<Text key={row.index}>
					{` ${pad(row.index, w.index)} │ ${pad(row.type, w.type)} │ ${pad(row.cli, w.cli)} │ ${pad(row.tokens, w.tokens)} │ ${pad(row.duration, w.duration)} │ ${pad(row.exitCode, w.exitCode)} `}
				</Text>
			))}
		</Box>
	);
}

function DetailedView({ specName, cwd }: { specName: string; cwd: string }) {
	const config = loadConfig(cwd);
	const specs = discoverSpecs(cwd, config);
	const spec = findSpec(specs, specName);

	if (!spec) {
		return <Text color="red">Spec not found: {specName}</Text>;
	}

	let statusData;
	let statusWarning: string | null = null;
	try {
		statusData = readStatus(cwd);
	} catch {
		statusWarning = "Corrupt status.json — showing defaults.";
		statusData = { specs: {} } as import("../types.js").StatusData;
	}
	const entry = getSpecStatus(statusData, spec.name);

	const iterationRows: IterationRow[] = entry.iterations.map((iter, i) => ({
		index: String(i + 1),
		type: iter.type,
		cli: iter.cli,
		tokens: iter.tokensUsed != null ? String(iter.tokensUsed) : "—",
		duration: formatDuration(iter.startedAt, iter.completedAt),
		exitCode: iter.exitCode != null ? String(iter.exitCode) : "—",
	}));

	const totalTokens = entry.iterations.reduce(
		(sum: number, iter: { tokensUsed: number | null }) => sum + (iter.tokensUsed ?? 0),
		0,
	);

	return (
		<Box flexDirection="column">
			{statusWarning && <Text color="yellow">{statusWarning}</Text>}
			<Text bold>{spec.name}</Text>
			<Text>Status: {entry.status}</Text>
			<Text>{""}</Text>
			<IterationTable rows={iterationRows} />
			<Text>{""}</Text>
			<Text>Iterations: {entry.iterations.length}</Text>
			<Text>Tokens used: {totalTokens}</Text>
		</Box>
	);
}

export default function Status({ spec, version }: StatusFlags) {
	const cwd = process.cwd();
	const localDir = getLocalDir(cwd);

	if (!fs.existsSync(localDir)) {
		return (
			<Box flexDirection="column">
				<Text color="red" bold>
					Toby not initialized
				</Text>
				<Text>
					{"Run "}
					<Text color="cyan">toby init</Text>
					{" to set up your project."}
				</Text>
			</Box>
		);
	}

	if (spec) {
		return <DetailedView specName={spec} cwd={cwd} />;
	}

	const { rows, warnings } = buildRows(cwd);

	if (rows.length === 0) {
		return (
			<Box flexDirection="column">
				<Text>{`toby v${version}`}</Text>
				{warnings.map((w) => (
					<Text key={w} color="yellow">{w}</Text>
				))}
				<Text dimColor>No specs found. Add .md files to your specs directory.</Text>
			</Box>
		);
	}

	return (
		<Box flexDirection="column">
			<Text>{`toby v${version}`}</Text>
			{warnings.map((w) => (
				<Text key={w} color="yellow">{w}</Text>
			))}
			<Text>{""}</Text>
			<StatusTable rows={rows} />
		</Box>
	);
}
