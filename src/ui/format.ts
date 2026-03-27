import chalk from "chalk";
import type { ProjectStats } from "../lib/stats.js";
import type { SpecStatusEntry } from "../types.js";

export function banner(version: string, stats?: ProjectStats | null): string {
	const lines: string[] = [];
	lines.push(chalk.hex("#f0a030").bold(`toby v${version}`));
	if (stats) {
		lines.push(
			`${chalk.dim("Specs:")} ${stats.totalSpecs}` +
			` ${chalk.dim("·")} ${chalk.dim("Planned:")} ${stats.planned}` +
			` ${chalk.dim("·")} ${chalk.dim("Done:")} ${stats.done}` +
			` ${chalk.dim("·")} ${chalk.dim("Tokens:")} ${formatTokens(stats.totalTokens)}`,
		);
	}
	return lines.join("\n");
}

export function formatStatusTable(
	rows: { name: string; status: string; iterations: number; tokens: number }[],
): string {
	const headers = { name: "Spec", status: "Status", iterations: "Iter", tokens: "Tokens" };
	const w = {
		name: Math.max(headers.name.length, ...rows.map((r) => r.name.length)),
		status: Math.max(headers.status.length, ...rows.map((r) => r.status.length)),
		iterations: Math.max(headers.iterations.length, ...rows.map((r) => String(r.iterations).length)),
		tokens: Math.max(headers.tokens.length, ...rows.map((r) => String(r.tokens).length)),
	};

	const pad = (s: string, len: number) => s + " ".repeat(Math.max(0, len - s.length));
	const headerLine = ` ${pad(headers.name, w.name)} │ ${pad(headers.status, w.status)} │ ${pad(headers.iterations, w.iterations)} │ ${pad(headers.tokens, w.tokens)} `;
	const separator = `${"─".repeat(w.name + 2)}┼${"─".repeat(w.status + 2)}┼${"─".repeat(w.iterations + 2)}┼${"─".repeat(w.tokens + 2)}`;

	const lines: string[] = [
		chalk.bold(headerLine),
		chalk.dim(separator),
	];
	for (const row of rows) {
		lines.push(
			` ${pad(row.name, w.name)} │ ${pad(specBadge(row.status), w.status + (specBadge(row.status).length - row.status.length))} │ ${pad(String(row.iterations), w.iterations)} │ ${pad(String(row.tokens), w.tokens)} `,
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
		const headers = { index: "#", type: "Type", cli: "CLI", tokens: "Tokens", duration: "Duration", exitCode: "Exit" };
		const rows = entry.iterations.map((iter, i) => ({
			index: String(i + 1),
			type: iter.type,
			cli: iter.cli,
			tokens: iter.tokensUsed != null ? String(iter.tokensUsed) : "—",
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
			tokens: Math.max(headers.tokens.length, ...rows.map((r) => r.tokens.length)),
			duration: Math.max(headers.duration.length, ...rows.map((r) => r.duration.length)),
			exitCode: Math.max(headers.exitCode.length, ...rows.map((r) => r.exitCode.length)),
		};

		const pad = (s: string, len: number) => s + " ".repeat(Math.max(0, len - s.length));
		const headerLine = ` ${pad(headers.index, w.index)} │ ${pad(headers.type, w.type)} │ ${pad(headers.cli, w.cli)} │ ${pad(headers.tokens, w.tokens)} │ ${pad(headers.duration, w.duration)} │ ${pad(headers.exitCode, w.exitCode)} `;
		const separator = `${"─".repeat(w.index + 2)}┼${"─".repeat(w.type + 2)}┼${"─".repeat(w.cli + 2)}┼${"─".repeat(w.tokens + 2)}┼${"─".repeat(w.duration + 2)}┼${"─".repeat(w.exitCode + 2)}`;

		lines.push(chalk.bold(headerLine));
		lines.push(chalk.dim(separator));
		for (const row of rows) {
			lines.push(
				` ${pad(row.index, w.index)} │ ${pad(row.type, w.type)} │ ${pad(row.cli, w.cli)} │ ${pad(row.tokens, w.tokens)} │ ${pad(row.duration, w.duration)} │ ${pad(row.exitCode, w.exitCode)} `,
			);
		}
	}

	lines.push("");
	const totalTokens = entry.iterations.reduce(
		(sum, iter) => sum + (iter.tokensUsed ?? 0),
		0,
	);
	lines.push(`Iterations: ${entry.iterations.length}`);
	lines.push(`Tokens used: ${totalTokens}`);
	return lines.join("\n");
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
