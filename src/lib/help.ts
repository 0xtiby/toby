/** Per-command help definition */
export interface CommandHelp {
	/** One-line description (same as in global help) */
	summary: string;
	/** Usage pattern(s), one per line */
	usage: string[];
	/** Flag definitions */
	flags: FlagHelp[];
	/** 2-3 realistic usage examples */
	examples: CommandExample[];
}

export interface FlagHelp {
	/** Flag with placeholder, e.g. "--spec=<query>" */
	name: string;
	/** What this flag does */
	description: string;
}

export interface CommandExample {
	/** Full command invocation */
	command: string;
	/** What this example does */
	description: string;
}

/** Registry of per-command help — keyed by command name */
export const commandHelp: Record<string, CommandHelp> = {
	plan: {
		summary: "Plan specs with AI loop engine",
		usage: ["$ toby plan [options]"],
		flags: [
			{
				name: "--spec=<query>",
				description: "Target spec(s) by name, slug, number, or list",
			},
			{ name: "--specs=<names>", description: "Alias for --spec" },
			{ name: "--all", description: "Plan all pending specs" },
			{ name: "--iterations=<n>", description: "Override iteration count" },
			{ name: "--verbose", description: "Show full CLI output" },
			{
				name: "--transcript",
				description: "Save session transcript to file",
			},
			{
				name: "--cli=<name>",
				description: "Override AI CLI (claude, codex, opencode)",
			},
			{
				name: "--session=<name>",
				description: "Name the session for branch/PR naming",
			},
		],
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
	for (let i = 0; i < help.examples.length; i++) {
		const ex = help.examples[i];
		lines.push(`  $ ${ex.command}`);
		lines.push(`    ${ex.description}`);
		if (i < help.examples.length - 1) {
			lines.push("");
		}
	}

	lines.push("");
	return lines.join("\n");
}

/** Render global help (lean overview) */
export function formatGlobalHelp(version: string): string {
	return `toby v${version} — AI-assisted development loop engine

Usage
  $ toby <command> [options]

Commands
  plan     Plan specs with AI loop engine
  build    Build tasks one-per-spawn with AI
  init     Initialize toby in current project
  status   Show project status
  config   Manage configuration
  clean    Delete session transcripts

Options
  --help       Show help (use with a command for details)
  --version    Show version

Run toby <command> --help for command-specific options and examples.
`;
}
