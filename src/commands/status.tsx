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
			<Text dimColor>No task data available</Text>
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
