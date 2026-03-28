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

export function formatStatusTable(
	rows: { name: string; status: string; iterations: number; inputTokens: number; outputTokens: number; tokens: number; cost: number | null }[],
): string {
	const headers = { name: "Spec", status: "Status", iterations: "Iter", inputTokens: "Input", outputTokens: "Output", tokens: "Tokens", cost: "Cost" };

	const costStrs = rows.map((r) => formatCost(r.cost));
	const w = {
		name: Math.max(headers.name.length, ...rows.map((r) => r.name.length)),
		status: Math.max(headers.status.length, ...rows.map((r) => r.status.length)),
		iterations: Math.max(headers.iterations.length, ...rows.map((r) => String(r.iterations).length)),
		inputTokens: Math.max(headers.inputTokens.length, ...rows.map((r) => formatTokens(r.inputTokens).length)),
		outputTokens: Math.max(headers.outputTokens.length, ...rows.map((r) => formatTokens(r.outputTokens).length)),
		tokens: Math.max(headers.tokens.length, ...rows.map((r) => formatTokens(r.tokens).length)),
		cost: Math.max(headers.cost.length, ...costStrs.map((s) => s.length)),
	};

	const pad = (s: string, len: number) => s + " ".repeat(Math.max(0, len - s.length));
	const headerLine = ` ${pad(headers.name, w.name)} │ ${pad(headers.status, w.status)} │ ${pad(headers.iterations, w.iterations)} │ ${pad(headers.inputTokens, w.inputTokens)} │ ${pad(headers.outputTokens, w.outputTokens)} │ ${pad(headers.tokens, w.tokens)} │ ${pad(headers.cost, w.cost)} `;
	const separator = `${"─".repeat(w.name + 2)}┼${"─".repeat(w.status + 2)}┼${"─".repeat(w.iterations + 2)}┼${"─".repeat(w.inputTokens + 2)}┼${"─".repeat(w.outputTokens + 2)}┼${"─".repeat(w.tokens + 2)}┼${"─".repeat(w.cost + 2)}`;

	const lines: string[] = [
		chalk.bold(headerLine),
		chalk.dim(separator),
	];
	for (let i = 0; i < rows.length; i++) {
		const row = rows[i];
		const badge = specBadge(row.status);
		const badgeExtra = badge.length - row.status.length;
		lines.push(
			` ${pad(row.name, w.name)} │ ${pad(badge, w.status + badgeExtra)} │ ${pad(String(row.iterations), w.iterations)} │ ${pad(formatTokens(row.inputTokens), w.inputTokens)} │ ${pad(formatTokens(row.outputTokens), w.outputTokens)} │ ${pad(formatTokens(row.tokens), w.tokens)} │ ${pad(costStrs[i], w.cost)} `,
		);
	}
	return lines.join("\n");
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
		const headers = { index: "#", type: "Type", cli: "CLI", inputTokens: "Input", outputTokens: "Output", tokens: "Tokens", cost: "Cost", duration: "Duration", exitCode: "Exit" };
		const rows = entry.iterations.map((iter, i) => ({
			index: String(i + 1),
			type: iter.type,
			cli: iter.cli,
			inputTokens: iter.inputTokens != null ? formatTokens(iter.inputTokens) : "—",
			outputTokens: iter.outputTokens != null ? formatTokens(iter.outputTokens) : "—",
			tokens: iter.tokensUsed != null ? formatTokens(iter.tokensUsed) : "—",
			cost: formatCost(iter.cost),
			duration: formatDuration(
				iter.completedAt
					? new Date(iter.completedAt).getTime() - new Date(iter.startedAt).getTime()
					: 0,
			),
			exitCode: iter.exitCode != null ? String(iter.exitCode) : "—",
		}));

		const w = {
			index: Math.max(headers.index.length, ...rows.map((r) => r.index.length)),
			type: Math.max(headers.type.length, ...rows.map((r) => r.type.length)),
			cli: Math.max(headers.cli.length, ...rows.map((r) => r.cli.length)),
			inputTokens: Math.max(headers.inputTokens.length, ...rows.map((r) => r.inputTokens.length)),
			outputTokens: Math.max(headers.outputTokens.length, ...rows.map((r) => r.outputTokens.length)),
			tokens: Math.max(headers.tokens.length, ...rows.map((r) => r.tokens.length)),
			cost: Math.max(headers.cost.length, ...rows.map((r) => r.cost.length)),
			duration: Math.max(headers.duration.length, ...rows.map((r) => r.duration.length)),
			exitCode: Math.max(headers.exitCode.length, ...rows.map((r) => r.exitCode.length)),
		};

		const pad = (s: string, len: number) => s + " ".repeat(Math.max(0, len - s.length));
		const headerLine = ` ${pad(headers.index, w.index)} │ ${pad(headers.type, w.type)} │ ${pad(headers.cli, w.cli)} │ ${pad(headers.inputTokens, w.inputTokens)} │ ${pad(headers.outputTokens, w.outputTokens)} │ ${pad(headers.tokens, w.tokens)} │ ${pad(headers.cost, w.cost)} │ ${pad(headers.duration, w.duration)} │ ${pad(headers.exitCode, w.exitCode)} `;
		const separator = `${"─".repeat(w.index + 2)}┼${"─".repeat(w.type + 2)}┼${"─".repeat(w.cli + 2)}┼${"─".repeat(w.inputTokens + 2)}┼${"─".repeat(w.outputTokens + 2)}┼${"─".repeat(w.tokens + 2)}┼${"─".repeat(w.cost + 2)}┼${"─".repeat(w.duration + 2)}┼${"─".repeat(w.exitCode + 2)}`;

		lines.push(chalk.bold(headerLine));
		lines.push(chalk.dim(separator));
		for (const row of rows) {
			lines.push(
				` ${pad(row.index, w.index)} │ ${pad(row.type, w.type)} │ ${pad(row.cli, w.cli)} │ ${pad(row.inputTokens, w.inputTokens)} │ ${pad(row.outputTokens, w.outputTokens)} │ ${pad(row.tokens, w.tokens)} │ ${pad(row.cost, w.cost)} │ ${pad(row.duration, w.duration)} │ ${pad(row.exitCode, w.exitCode)} `,
			);
		}
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

export function formatCost(n: number | null): string {
	if (n == null) return "—";
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
