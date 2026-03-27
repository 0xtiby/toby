import chalk from "chalk";
import type { CliEvent } from "@0xtiby/spawner";

export function writeEvent(event: CliEvent, verbose: boolean): void {
	if (!verbose && event.type !== "text") return;
	const line = formatEvent(event);
	process.stdout.write(line + "\n");
}

function formatEvent(event: CliEvent): string {
	switch (event.type) {
		case "text":
			return `  ${event.content ?? ""}`;
		case "tool_use":
			return chalk.cyan(`  ⚙ ${event.tool?.name ?? "tool"}`);
		case "tool_result":
			return chalk.gray(`  ↳ ${(event.content ?? "").slice(0, 120)}`);
		case "error":
			return chalk.red(`  ✗ ${event.content ?? "error"}`);
		case "system":
			return chalk.yellow(`  [system] ${event.content ?? ""}`);
		default:
			return "";
	}
}

export function writeEventPlain(event: CliEvent, verbose: boolean): void {
	if (!verbose && event.type !== "text") return;
	const content = event.content ?? event.tool?.name ?? "";
	process.stdout.write(`  ${content}\n`);
}
