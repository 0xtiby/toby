import meow from "meow";
import React from "react";
import { render, Text } from "ink";
import Plan from "./commands/plan.js";
import Build from "./commands/build.js";
import Init from "./commands/init.js";
import Status from "./commands/status.js";
import Config, { ConfigEditor } from "./commands/config.js";
import { ensureGlobalDir } from "./lib/paths.js";

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

Init Options
  --plan-cli=<name>    Set plan CLI (claude, codex, opencode)
  --plan-model=<id>    Set plan model
  --build-cli=<name>   Set build CLI (claude, codex, opencode)
  --build-model=<id>   Set build model
  --specs-dir=<path>   Set specs directory

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
			planCli: { type: "string" },
			planModel: { type: "string" },
			buildCli: { type: "string" },
			buildModel: { type: "string" },
			specsDir: { type: "string" },
		},
	},
);

ensureGlobalDir();

interface CommandEntry {
	render: (
		flags: typeof cli.flags,
		input: string[],
		version: string,
	) => React.ReactElement;
	waitForExit?: boolean;
}

const commands: Record<string, CommandEntry> = {
	plan: {
		render: (flags) => (
			<Plan
				spec={flags.spec}
				all={flags.all}
				iterations={flags.iterations}
				verbose={flags.verbose}
				cli={flags.cli}
			/>
		),
		waitForExit: true,
	},
	build: {
		render: (flags) => (
			<Build
				spec={flags.spec}
				all={flags.all}
				iterations={flags.iterations}
				verbose={flags.verbose}
				cli={flags.cli}
			/>
		),
		waitForExit: true,
	},
	init: {
		render: (flags, _input, version) => (
			<Init
				version={version}
				planCli={flags.planCli}
				planModel={flags.planModel}
				buildCli={flags.buildCli}
				buildModel={flags.buildModel}
				specsDir={flags.specsDir}
			/>
		),
		waitForExit: true,
	},
	status: {
		render: (flags, _input, version) => (
			<Status spec={flags.spec} version={version} />
		),
	},
	config: {
		render: (_flags, input, version) => {
			const [, subcommand, configKey, value] = input;
			if (!subcommand) return <ConfigEditor version={version} />;
			return (
				<Config
					subcommand={subcommand}
					configKey={configKey}
					value={value}
					version={version}
				/>
			);
		},
		waitForExit: true,
	},
};

const version = cli.pkg.version ?? "0.0.0";
const [command] = cli.input;

if (!command) {
	render(<Help version={version} />).unmount();
} else if (command in commands) {
	const entry = commands[command];
	const app = render(entry.render(cli.flags, cli.input, version));
	if (entry.waitForExit) {
		await app.waitUntilExit();
	} else {
		app.unmount();
	}
} else {
	render(<UnknownCommand command={command} />).unmount();
	process.exitCode = 1;
}
