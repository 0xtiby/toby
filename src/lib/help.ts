export interface CommandHelp {
	summary: string;
	usage: string[];
	flags: FlagHelp[];
	examples: CommandExample[];
}

export interface FlagHelp {
	name: string;
	description: string;
}

export interface CommandExample {
	command: string;
	description: string;
}

const SPEC_FLAGS: FlagHelp[] = [
	{ name: "--spec=<query>", description: "Target spec(s) by name, slug, number, or list" },
	{ name: "--specs=<names>", description: "Alias for --spec" },
	{ name: "--all", description: "Process all matching specs" },
	{ name: "--iterations=<n>", description: "Override iteration count" },
	{ name: "--verbose", description: "Show full CLI output" },
	{ name: "--transcript", description: "Save session transcript to file" },
	{ name: "--cli=<name>", description: "Override AI CLI (claude, codex, opencode)" },
	{ name: "--session=<name>", description: "Name the session for branch/PR naming" },
];

export const commandHelp: Record<string, CommandHelp> = {
	plan: {
		summary: "Plan specs with AI loop engine",
		usage: ["$ toby plan [options]"],
		flags: SPEC_FLAGS,
		examples: [
			{
				command: "toby plan --spec=auth --cli=claude --session=auth-feature",
				description:
					'Plan the auth spec using Claude, naming the session "auth-feature"',
			},
			{
				command: "toby plan --spec=auth,payments --iterations=3 --verbose",
				description:
					"Plan auth and payments specs with 3 iterations, showing full output",
			},
			{
				command: "toby plan --all --transcript",
				description:
					"Plan all pending specs and save a transcript of the session",
			},
		],
	},
	build: {
		summary: "Build tasks one-per-spawn with AI",
		usage: ["$ toby build [options]"],
		flags: SPEC_FLAGS,
		examples: [
			{
				command:
					"toby build --spec=auth --cli=claude --session=auth-feature",
				description:
					'Build the auth spec using Claude, resuming "auth-feature"',
			},
			{
				command: "toby build --all --iterations=5 --transcript",
				description:
					"Build all planned specs with up to 5 iterations, saving transcripts",
			},
			{
				command: "toby build --spec=2 --verbose",
				description: "Build spec #2 with full CLI output visible",
			},
		],
	},
	resume: {
		summary: "Resume an interrupted build session",
		usage: ["$ toby resume [options]"],
		flags: [
			{ name: "--iterations=<n>", description: "Override iteration count" },
			{ name: "--verbose", description: "Show full CLI output" },
			{ name: "--transcript", description: "Save session transcript to file" },
		],
		examples: [
			{
				command: "toby resume",
				description:
					"Resume the most recent interrupted session from where it left off",
			},
			{
				command: "toby resume --iterations=10 --verbose",
				description:
					"Resume with 10 iterations per spec and full CLI output",
			},
			{
				command: "toby resume --transcript",
				description:
					"Resume and save a transcript of the resumed session",
			},
		],
	},
	init: {
		summary: "Initialize toby in current project",
		usage: ["$ toby init [options]"],
		flags: [
			{
				name: "--plan-cli=<name>",
				description: "Set plan CLI (claude, codex, opencode)",
			},
			{ name: "--plan-model=<id>", description: "Set plan model" },
			{
				name: "--build-cli=<name>",
				description: "Set build CLI (claude, codex, opencode)",
			},
			{ name: "--build-model=<id>", description: "Set build model" },
			{ name: "--specs-dir=<path>", description: "Set specs directory" },
			{
				name: "--verbose",
				description: "Enable verbose output in config",
			},
		],
		examples: [
			{
				command: "toby init",
				description: "Launch the interactive setup wizard",
			},
			{
				command:
					"toby init --plan-cli=claude --build-cli=claude --specs-dir=specs",
				description:
					"Non-interactive init with required flags (for CI/agents)",
			},
			{
				command:
					"toby init --plan-cli=codex --build-cli=codex --specs-dir=specs --verbose",
				description:
					"Initialize with Codex for both phases, verbose enabled",
			},
		],
	},
	status: {
		summary: "Show project status",
		usage: ["$ toby status [options]"],
		flags: [
			{
				name: "--spec=<query>",
				description:
					"Show status for a specific spec by name, slug, or number",
			},
		],
		examples: [
			{
				command: "toby status",
				description:
					"Show status overview for all specs in the project",
			},
			{
				command: "toby status --spec=auth",
				description: "Show detailed status for the auth spec",
			},
		],
	},
	config: {
		summary: "Manage configuration",
		usage: [
			"$ toby config                           Interactive config editor",
			"$ toby config get <key>                 Show a config value (dot-notation)",
			"$ toby config set <key> <value>         Set a config value",
			"$ toby config set <k>=<v> [<k>=<v>...]  Batch set values",
		],
		flags: [],
		examples: [
			{
				command: "toby config",
				description: "Open the interactive config editor",
			},
			{
				command: "toby config get plan.cli",
				description: "Show the configured plan CLI",
			},
			{
				command: "toby config set plan.cli=claude build.iterations=5",
				description:
					"Batch set plan CLI to claude and build iterations to 5",
			},
		],
	},
	clean: {
		summary: "Delete session transcripts",
		usage: ["$ toby clean [options]"],
		flags: [
			{
				name: "--force",
				description: "Skip confirmation prompt (required in non-TTY)",
			},
		],
		examples: [
			{
				command: "toby clean",
				description:
					"Delete all transcripts with confirmation prompt",
			},
			{
				command: "toby clean --force",
				description:
					"Delete all transcripts without confirmation (for CI/agents)",
			},
		],
	},
};

/** Render per-command help with examples */
export function formatCommandHelp(
	command: string,
	help: CommandHelp,
): string {
	const lines: string[] = [];

	lines.push(`toby ${command} — ${help.summary}`);
	lines.push("");
	lines.push("Usage");
	for (const usage of help.usage) {
		lines.push(`  ${usage}`);
	}

	if (help.flags.length > 0) {
		lines.push("");
		lines.push("Options");
		const maxName = Math.max(...help.flags.map((f) => f.name.length));
		for (const flag of help.flags) {
			lines.push(`  ${flag.name.padEnd(maxName)}   ${flag.description}`);
		}
	}

	lines.push("");
	lines.push("Examples");
	const exampleBlocks = help.examples.map(
		(ex) => `  $ ${ex.command}\n    ${ex.description}`,
	);
	lines.push(exampleBlocks.join("\n\n"));

	lines.push("");
	return lines.join("\n");
}

/** Render error with valid values and example invocation */
export function formatErrorWithHint(
	message: string,
	validValues?: string[],
	example?: string,
): string {
	const lines: string[] = [];

	if (validValues) {
		lines.push(`✗ ${message}. Valid options: ${validValues.join(", ")}`);
	} else {
		lines.push(`✗ ${message}`);
	}

	if (example) {
		lines.push("");
		lines.push("Example:");
		lines.push(`  $ ${example}`);
	}

	lines.push("");
	return lines.join("\n");
}

export function formatGlobalHelp(version: string): string {
	const maxCmd = Math.max(
		...Object.keys(commandHelp).map((c) => c.length),
	);
	const cmdLines = Object.entries(commandHelp)
		.map(([name, h]) => `  ${name.padEnd(maxCmd)}   ${h.summary}`)
		.join("\n");

	return [
		`toby v${version} — AI-assisted development loop engine`,
		"",
		"Usage",
		"  $ toby <command> [options]",
		"",
		"Commands",
		cmdLines,
		"",
		"Options",
		"  --help       Show help (use with a command for details)",
		"  --version    Show version",
		"",
		"Run toby <command> --help for command-specific options and examples.",
		"",
	].join("\n");
}
