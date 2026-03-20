import React from "react";
import { Text, Box } from "ink";
import fs from "node:fs";
import { loadConfig } from "../lib/config.js";
import { discoverSpecs } from "../lib/specs.js";
import { readStatus, getSpecStatus } from "../lib/status.js";
import { readPrd, getTaskSummary } from "../lib/prd.js";
import { getLocalDir } from "../lib/paths.js";

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

function buildRows(cwd: string): SpecRow[] {
	const config = loadConfig(cwd);
	const specs = discoverSpecs(cwd, config);
	const statusData = readStatus(cwd);

	return specs.map((spec) => {
		const entry = getSpecStatus(statusData, spec.name);
		const prd = readPrd(spec.name, cwd);
		let tasks = "—";
		if (prd) {
			const summary = getTaskSummary(prd);
			tasks = `${summary.done}/${prd.tasks.length}`;
		}
		return {
			name: spec.name,
			status: entry.status,
			tasks,
			iterations: entry.iterations.length,
		};
	});
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

export default function Status({ version }: StatusFlags) {
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

	const rows = buildRows(cwd);

	if (rows.length === 0) {
		return (
			<Box flexDirection="column">
				<Text>{`toby v${version}`}</Text>
				<Text dimColor>No specs found. Add .md files to your specs directory.</Text>
			</Box>
		);
	}

	return (
		<Box flexDirection="column">
			<Text>{`toby v${version}`}</Text>
			<Text>{""}</Text>
			<StatusTable rows={rows} />
		</Box>
	);
}
