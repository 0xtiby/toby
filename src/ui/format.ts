import chalk from "chalk";
import type { ProjectStats } from "../lib/stats.js";
import type { SpecStatusEntry } from "../types.js";

export function banner(version: string, stats?: ProjectStats | null): string {
	const lines: string[] = [];
	lines.push(chalk.hex("#f0a030").bold(`toby v${version}`));
	if (stats) {
		let statsLine =
			`${chalk.dim("Specs:")} ${stats.totalSpecs}` +
			` ${chalk.dim("·")} ${chalk.dim("Planned:")} ${stats.planned}` +
			` ${chalk.dim("·")} ${chalk.dim("Done:")} ${stats.done}` +
			` ${chalk.dim("·")} ${chalk.dim("Tokens:")} ${formatTokens(stats.totalTokens)}`;
		if (stats.totalCost > 0) {
			statsLine += ` ${chalk.dim("·")} ${chalk.dim("Cost:")} ${formatCost(stats.totalCost)}`;
		}
		lines.push(statsLine);
	}
	return lines.join("\n");
}

interface Column<T> {
	header: string;
	value: (row: T) => string;
	/** Optional display transform (e.g. chalk coloring) that may add invisible chars. Raw `value` is used for width calc. */
	display?: (row: T, raw: string) => string;
}

function renderTable<T>(columns: Column<T>[], rows: T[]): string {
	const pad = (s: string, len: number) => s + " ".repeat(Math.max(0, len - s.length));
	const rawValues = rows.map((row) => columns.map((col) => col.value(row)));
	const widths = columns.map((col, ci) =>
		Math.max(col.header.length, ...rawValues.map((vals) => vals[ci].length)),
	);

	const headerLine = " " + columns.map((col, ci) => pad(col.header, widths[ci])).join(" │ ") + " ";
	const separator = widths.map((w) => "─".repeat(w + 2)).join("┼");

	const lines: string[] = [chalk.bold(headerLine), chalk.dim(separator)];
	for (let ri = 0; ri < rows.length; ri++) {
		const cells = columns.map((col, ci) => {
			const raw = rawValues[ri][ci];
			const displayed = col.display ? col.display(rows[ri], raw) : raw;
			const extra = displayed.length - raw.length;
			return pad(displayed, widths[ci] + extra);
		});
		lines.push(" " + cells.join(" │ ") + " ");
	}
	return lines.join("\n");
}

export function formatStatusTable(
	rows: { name: string; status: string; iterations: number; inputTokens: number; outputTokens: number; tokens: number; cost: number | null }[],
): string {
	const columns: Column<(typeof rows)[number]>[] = [
		{ header: "Spec", value: (r) => r.name },
		{ header: "Status", value: (r) => r.status, display: (r) => specBadge(r.status) },
		{ header: "Iter", value: (r) => String(r.iterations) },
		{ header: "Input", value: (r) => formatTokens(r.inputTokens) },
		{ header: "Output", value: (r) => formatTokens(r.outputTokens) },
		{ header: "Tokens", value: (r) => formatTokens(r.tokens) },
		{ header: "Cost", value: (r) => formatCost(r.cost) },
	];
	return renderTable(columns, rows);
}

interface DetailRow {
	iter: SpecStatusEntry["iterations"][number];
	index: number;
}

export function formatDetailTable(
	specName: string,
	entry: SpecStatusEntry,
): string {
	const lines: string[] = [];
	lines.push(chalk.bold(specName));
	lines.push(`Status: ${specBadge(entry.status)}`);
	lines.push("");

	if (entry.iterations.length === 0) {
		lines.push(chalk.dim("No iterations yet"));
	} else {
		const columns: Column<DetailRow>[] = [
			{ header: "#", value: (r) => String(r.index + 1) },
			{ header: "Type", value: (r) => r.iter.type },
			{ header: "CLI", value: (r) => r.iter.cli },
			{ header: "Input", value: (r) => r.iter.inputTokens != null ? formatTokens(r.iter.inputTokens) : "—" },
			{ header: "Output", value: (r) => r.iter.outputTokens != null ? formatTokens(r.iter.outputTokens) : "—" },
			{ header: "Tokens", value: (r) => r.iter.tokensUsed != null ? formatTokens(r.iter.tokensUsed) : "—" },
			{ header: "Cost", value: (r) => formatCost(r.iter.cost) },
			{ header: "Duration", value: (r) => formatDuration(r.iter.completedAt ? new Date(r.iter.completedAt).getTime() - new Date(r.iter.startedAt).getTime() : 0) },
			{ header: "Exit", value: (r) => r.iter.exitCode != null ? String(r.iter.exitCode) : "—" },
		];
		const detailRows = entry.iterations.map((iter, i) => ({ iter, index: i }));
		lines.push(renderTable(columns, detailRows));
	}

	lines.push("");
	const totalTokens = entry.iterations.reduce((sum, iter) => sum + (iter.tokensUsed ?? 0), 0);
	const totalInputTokens = entry.iterations.reduce((sum, iter) => sum + (iter.inputTokens ?? 0), 0);
	const totalOutputTokens = entry.iterations.reduce((sum, iter) => sum + (iter.outputTokens ?? 0), 0);
	const totalCost = entry.iterations.reduce((sum, iter) => sum + (iter.cost ?? 0), 0);
	const hasCostData = entry.iterations.some((iter) => iter.cost != null);

	lines.push(`Iterations: ${entry.iterations.length}`);
	lines.push(`Input tokens: ${formatTokens(totalInputTokens)}`);
	lines.push(`Output tokens: ${formatTokens(totalOutputTokens)}`);
	lines.push(`Tokens used: ${formatTokens(totalTokens)}`);
	if (hasCostData) {
		lines.push(`Cost: ${formatCost(totalCost)}`);
	}
	return lines.join("\n");
}

export function sumResults<T extends { totalIterations: number; totalTokens: number; totalCost: number }>(
	results: T[],
): { totalIter: number; totalTok: number; totalCost: number } {
	return {
		totalIter: results.reduce((s, r) => s + r.totalIterations, 0),
		totalTok: results.reduce((s, r) => s + r.totalTokens, 0),
		totalCost: results.reduce((s, r) => s + r.totalCost, 0),
	};
}

export function costSuffix(cost: number, { prefix = ", " } = {}): string {
	return cost > 0 ? `${prefix}${formatCost(cost)}` : "";
}

export function formatCost(n: number | null): string {
	if (n == null) return "—";
	if (n > 0 && n < 0.01) return `$${n.toFixed(4)}`;
	return `$${n.toFixed(2)}`;
}

export function formatTokens(n: number): string {
	return new Intl.NumberFormat().format(n);
}

export function formatDuration(ms: number): string {
	if (ms <= 0) return "—";
	const seconds = Math.floor(ms / 1000);
	const minutes = Math.floor(seconds / 60);
	const remainingSeconds = seconds % 60;
	return `${minutes}m ${remainingSeconds}s`;
}

export function specBadge(status: string): string {
	switch (status) {
		case "pending":
			return chalk.gray(status);
		case "planned":
			return chalk.blue(status);
		case "building":
			return chalk.yellow(status);
		case "done":
			return chalk.green(status);
		default:
			return status;
	}
}
