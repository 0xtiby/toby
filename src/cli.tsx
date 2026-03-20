import meow from "meow";
import React from "react";
import { render, Text } from "ink";
import Plan from "./commands/plan.js";
import type { PlanFlags } from "./commands/plan.js";
import Build from "./commands/build.js";
import type { BuildFlags } from "./commands/build.js";
import Init from "./commands/init.js";
import Status from "./commands/status.js";
import type { StatusFlags } from "./commands/status.js";
import Config from "./commands/config.js";
import type { ConfigFlags } from "./commands/config.js";
import { ensureGlobalDir } from "./lib/paths.js";

const COMMANDS = ["plan", "build", "init", "status", "config"] as const;
type Command = (typeof COMMANDS)[number];

function Help({ version }: { version: string }) {
	return (
		<Text>
			{`toby v${version} — AI-assisted development loop engine

Usage
  $ toby <command> [options]

Commands
  plan     Plan specs with AI loop engine
  build    Build tasks one-per-spawn with AI
  init     Initialize toby in current project
  status   Show project status
  config   Manage configuration

Options
  --help       Show this help
  --version    Show version`}
		</Text>
	);
}

function UnknownCommand({ command }: { command: string }) {
	return (
		<Text color="red">
			{`Unknown command: ${command}\nRun "toby --help" for available commands.`}
		</Text>
	);
}

const cli = meow(
	`
Usage
  $ toby <command> [options]

Commands
  plan     Plan specs with AI loop engine
  build    Build tasks one-per-spawn with AI
  init     Initialize toby in current project
  status   Show project status
  config   Manage configuration

Plan Options
  --spec=<name>      Plan a specific spec
  --all              Plan all pending specs
  --iterations=<n>   Override iteration count
  --verbose          Show full CLI output
  --cli=<name>       Override AI CLI (claude, codex, opencode)

Build Options
  --spec=<name>      Build a specific planned spec
  --all              Build all planned specs in order
  --iterations=<n>   Override max iteration count
  --verbose          Show full CLI output
  --cli=<name>       Override AI CLI (claude, codex, opencode)

Status Options
  --spec=<name>      Show detailed status for a specific spec

Config Subcommands
  config             Interactive config editor
  config get <key>   Show a config value (dot-notation)
  config set <key> <value>  Set a config value
`,
	{
		importMeta: import.meta,
		flags: {
			spec: { type: "string" },
			all: { type: "boolean", default: false },
			iterations: { type: "number" },
			verbose: { type: "boolean", default: false },
			cli: { type: "string" },
		},
	},
);

ensureGlobalDir();

const version = cli.pkg.version ?? "0.0.0";
const [command] = cli.input;

if (!command) {
	render(<Help version={version} />).unmount();
} else if (command === "plan") {
	const flags: PlanFlags = {
		spec: cli.flags.spec,
		all: cli.flags.all,
		iterations: cli.flags.iterations,
		verbose: cli.flags.verbose,
		cli: cli.flags.cli,
	};
	const app = render(<Plan {...flags} />);
	await app.waitUntilExit();
} else if (command === "build") {
	const flags: BuildFlags = {
		spec: cli.flags.spec,
		all: cli.flags.all,
		iterations: cli.flags.iterations,
		verbose: cli.flags.verbose,
		cli: cli.flags.cli,
	};
	const app = render(<Build {...flags} />);
	await app.waitUntilExit();
} else if (command === "init") {
	const app = render(<Init version={version} />);
	await app.waitUntilExit();
} else if (command === "status") {
	const flags: StatusFlags = {
		spec: cli.flags.spec,
		version,
	};
	render(<Status {...flags} />).unmount();
} else if (command === "config") {
	const [, subcommand, configKey, value] = cli.input;
	const flags: ConfigFlags = {
		subcommand,
		configKey,
		value,
		version,
	};
	render(<Config {...flags} />).unmount();
} else {
	render(<UnknownCommand command={command} />).unmount();
	process.exitCode = 1;
}
