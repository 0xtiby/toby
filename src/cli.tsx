import meow from "meow";
import React from "react";
import { render, Text } from "ink";

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

function CommandStub({ command }: { command: Command }) {
	return (
		<Text>
			{`toby ${command} — not yet implemented`}
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
`,
	{
		importMeta: import.meta,
		flags: {},
	},
);

const [command] = cli.input;

if (!command) {
	render(<Help version={cli.pkg.version ?? "0.0.0"} />).unmount();
} else if (COMMANDS.includes(command as Command)) {
	render(<CommandStub command={command as Command} />).unmount();
} else {
	render(<UnknownCommand command={command} />).unmount();
	process.exitCode = 1;
}
