import meow from "meow";
import React from "react";
import { render, Text } from "ink";
import Plan from "./commands/plan.js";
import Build from "./commands/build.js";
import Init from "./commands/init.js";
import Status from "./commands/status.js";
import Config from "./commands/config.js";
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

const commandComponents: Record<Command, React.ComponentType> = {
	plan: Plan,
	build: Build,
	init: Init,
	status: Status,
	config: Config,
};

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
`,
	{
		importMeta: import.meta,
		flags: {},
	},
);

ensureGlobalDir();

const [command] = cli.input;

if (!command) {
	render(<Help version={cli.pkg.version ?? "0.0.0"} />).unmount();
} else if (COMMANDS.includes(command as Command)) {
	const CommandComponent = commandComponents[command as Command];
	render(<CommandComponent />).unmount();
} else {
	render(<UnknownCommand command={command} />).unmount();
	process.exitCode = 1;
}
