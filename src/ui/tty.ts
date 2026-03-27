import chalk from "chalk";

export function isTTY(): boolean {
	return Boolean(process.stdout.isTTY);
}

export function requireTTY(command: string, suggestion: string): void {
	if (!isTTY()) {
		console.error(
			`${chalk.red("✖")} toby ${command} requires an interactive terminal.\n  ${suggestion}`,
		);
		process.exit(1);
	}
}
