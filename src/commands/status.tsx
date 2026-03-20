import React from "react";
import { Text, Box } from "ink";
import fs from "node:fs";
import { loadConfig } from "../lib/config.js";
import { discoverSpecs, findSpec } from "../lib/specs.js";
import { readStatus, getSpecStatus } from "../lib/status.js";
import { readPrd, getTaskSummary } from "../lib/prd.js";
import { getLocalDir } from "../lib/paths.js";
import type { Task } from "../types.js";

export interface StatusFlags {
	spec?: string;
	version: string;
}

interface SpecRow {
	name: string;
	status: string;
	tasks: string;
	iterations: number;
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
		let tasks = "—";
		try {
			const prd = readPrd(spec.name, cwd);
			if (prd) {
				const summary = getTaskSummary(prd);
				tasks = `${summary.done}/${prd.tasks.length}`;
			}
		} catch {
			// Corrupt prd.json — show dash instead of crashing
		}
		return {
			name: spec.name,
			status: entry.status,
			tasks,
			iterations: entry.iterations.length,
		};
	});

	return { rows, warnings };
}

function pad(str: string, len: number): string {
	return str + " ".repeat(Math.max(0, len - str.length));
}

function StatusTable({ rows }: { rows: SpecRow[] }) {
	const headers = { name: "Spec", status: "Status", tasks: "Tasks", iterations: "Iter" };
	const colWidths = {
		name: Math.max(headers.name.length, ...rows.map((r) => r.name.length)),
		status: Math.max(headers.status.length, ...rows.map((r) => r.status.length)),
		tasks: Math.max(headers.tasks.length, ...rows.map((r) => r.tasks.length)),
		iterations: Math.max(headers.iterations.length, ...rows.map((r) => String(r.iterations).length)),
	};

	const separator = `${"─".repeat(colWidths.name + 2)}┼${"─".repeat(colWidths.status + 2)}┼${"─".repeat(colWidths.tasks + 2)}┼${"─".repeat(colWidths.iterations + 2)}`;
	const headerLine = ` ${pad(headers.name, colWidths.name)} │ ${pad(headers.status, colWidths.status)} │ ${pad(headers.tasks, colWidths.tasks)} │ ${pad(headers.iterations, colWidths.iterations)} `;

	return (
		<Box flexDirection="column">
			<Text bold>{headerLine}</Text>
			<Text dimColor>{separator}</Text>
			{rows.map((row) => (
				<Text key={row.name}>
					{` ${pad(row.name, colWidths.name)} │ ${pad(row.status, colWidths.status)} │ ${pad(row.tasks, colWidths.tasks)} │ ${pad(String(row.iterations), colWidths.iterations)} `}
				</Text>
			))}
		</Box>
	);
}

const STATUS_ICONS: Record<string, string> = {
	done: "✓",
	in_progress: "●",
	pending: "○",
	blocked: "○",
};

function statusIcon(status: string): string {
	return STATUS_ICONS[status] ?? "○";
}

interface TaskRow {
	id: string;
	title: string;
	status: string;
}

function TaskTable({ tasks }: { tasks: TaskRow[] }) {
	const headers = { id: "ID", title: "Title", status: "Status" };
	const colWidths = {
		id: Math.max(headers.id.length, ...tasks.map((t) => t.id.length)),
		title: Math.max(headers.title.length, ...tasks.map((t) => t.title.length)),
		status: Math.max(headers.status.length, ...tasks.map((t) => t.status.length)),
	};

	const separator = `${"─".repeat(colWidths.id + 2)}┼${"─".repeat(colWidths.title + 2)}┼${"─".repeat(colWidths.status + 2)}`;
	const headerLine = ` ${pad(headers.id, colWidths.id)} │ ${pad(headers.title, colWidths.title)} │ ${pad(headers.status, colWidths.status)} `;

	return (
		<Box flexDirection="column">
			<Text bold>{headerLine}</Text>
			<Text dimColor>{separator}</Text>
			{tasks.map((task) => (
				<Text key={task.id}>
					{` ${pad(task.id, colWidths.id)} │ ${pad(task.title, colWidths.title)} │ ${pad(task.status, colWidths.status)} `}
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

	let prd: import("../types.js").PRDData | null = null;
	let prdWarning: string | null = null;
	try {
		prd = readPrd(spec.name, cwd);
	} catch {
		prdWarning = "Corrupt prd.json — task data unavailable.";
	}

	const taskRows: TaskRow[] = prd
		? prd.tasks.map((t: Task) => ({
				id: t.id,
				title: t.title,
				status: `${statusIcon(t.status)} ${t.status}`,
			}))
		: [];

	const totalTokens = entry.iterations.reduce(
		(sum: number, iter: { tokensUsed: number | null }) => sum + (iter.tokensUsed ?? 0),
		0,
	);

	return (
		<Box flexDirection="column">
			{statusWarning && <Text color="yellow">{statusWarning}</Text>}
			{prdWarning && <Text color="yellow">{prdWarning}</Text>}
			<Text bold>{spec.name}</Text>
			<Text>Status: {entry.status}</Text>
			<Text>{""}</Text>
			{taskRows.length > 0 ? (
				<TaskTable tasks={taskRows} />
			) : (
				<Text dimColor>No tasks — run toby plan first.</Text>
			)}
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
