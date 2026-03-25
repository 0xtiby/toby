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
