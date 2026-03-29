import fs from "node:fs";
import chalk from "chalk";
import { loadConfig } from "../lib/config.js";
import { discoverSpecs, findSpec } from "../lib/specs.js";
import { readStatus, getSpecStatus } from "../lib/status.js";
import { getLocalDir } from "../lib/paths.js";
import { formatStatusTable, formatDetailTable, formatTokens, formatCost } from "../ui/format.js";
import type { StatusData } from "../types.js";

const NARROW_THRESHOLD = 40;

export interface RunStatusOptions {
	spec?: string;
	version: string;
}

export async function runStatus({ spec, version }: RunStatusOptions): Promise<void> {
	const cwd = process.cwd();
	const localDir = getLocalDir(cwd);

	if (!fs.existsSync(localDir)) {
		console.log(chalk.red.bold("Toby not initialized"));
		console.log(`Run ${chalk.cyan("toby init")} to set up your project.`);
		return;
	}

	if (spec) {
		printDetail(spec, cwd);
		return;
	}

	printOverview(version, cwd);
}

function printOverview(version: string, cwd: string): void {
	const config = loadConfig(cwd);
	const specs = discoverSpecs(cwd, config);
	const warnings: string[] = [];

	let statusData: StatusData;
	try {
		statusData = readStatus(cwd);
	} catch {
		warnings.push("Corrupt status.json — showing defaults. Run toby init to re-create.");
		statusData = { specs: {} } as StatusData;
	}

	console.log(`toby v${version}`);
	for (const w of warnings) {
		console.log(chalk.yellow(w));
	}

	if (specs.length === 0) {
		console.log(chalk.dim("No specs found. Add .md files to your specs directory."));
		return;
	}

	const termWidth = process.stdout.columns ?? 80;
	const rows = specs.map((s) => {
		const entry = getSpecStatus(statusData, s.name);
		const tokens = entry.iterations.reduce((sum, iter) => sum + (iter.tokensUsed ?? 0), 0);
		const inputTokens = entry.iterations.reduce((sum, iter) => sum + (iter.inputTokens ?? 0), 0);
		const outputTokens = entry.iterations.reduce((sum, iter) => sum + (iter.outputTokens ?? 0), 0);
		const iterCosts = entry.iterations.map((iter) => iter.cost);
		const hasCost = iterCosts.some((c) => c != null);
		const cost = hasCost ? iterCosts.reduce((sum, c) => sum + (c ?? 0), 0) : null;
		const name = termWidth < NARROW_THRESHOLD
			? s.name.slice(0, 15) + (s.name.length > 15 ? "…" : "")
			: s.name;
		return { name, status: entry.status, iterations: entry.iterations.length, inputTokens, outputTokens, tokens, cost };
	});

	console.log("");
	console.log(formatStatusTable(rows));

	const totalTokens = rows.reduce((sum, r) => sum + r.tokens, 0);
	const totalIterations = rows.reduce((sum, r) => sum + r.iterations, 0);
	const totalCost = rows.reduce((sum, r) => sum + (r.cost ?? 0), 0);
	let totalsLine = `Total: ${specs.length} specs · ${totalIterations} iterations · ${formatTokens(totalTokens)} tokens`;
	if (totalCost > 0) {
		totalsLine += ` · ${formatCost(totalCost)}`;
	}
	console.log("");
	console.log(chalk.dim(totalsLine));
}

function printDetail(specQuery: string, cwd: string): void {
	const config = loadConfig(cwd);
	const specs = discoverSpecs(cwd, config);
	const spec = findSpec(specs, specQuery);

	if (!spec) {
		console.log(chalk.red(`Spec not found: ${specQuery}`));
		return;
	}

	let statusData: StatusData;
	let statusWarning: string | null = null;
	try {
		statusData = readStatus(cwd);
	} catch {
		statusWarning = "Corrupt status.json — showing defaults.";
		statusData = { specs: {} } as StatusData;
	}

	if (statusWarning) {
		console.log(chalk.yellow(statusWarning));
	}

	const entry = getSpecStatus(statusData, spec.name);
	console.log(formatDetailTable(spec.name, entry));
}
