import meow from "meow";
import React from "react";
import { render, Text } from "ink";
import Plan from "./commands/plan.js";
import Build from "./commands/build.js";
import Init from "./commands/init.js";
import Status from "./commands/status.js";
import Config, { ConfigEditor, ConfigSetBatch } from "./commands/config.js";
import Welcome from "./components/Welcome.js";
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
  --version    Show version

Spec Selection
  --spec=<name>       Single spec or comma-separated (e.g. --spec=auth,payments)
  --specs=<names>     Alias for --spec`}
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
  --spec=<query>     Target spec(s) by name, slug, number, or comma-separated list
  --specs=<names>    Alias for --spec with comma-separated specs
  --all              Plan all pending specs
  --iterations=<n>   Override iteration count
  --verbose          Show full CLI output
  --transcript       Save session transcript to file
  --cli=<name>       Override AI CLI (claude, codex, opencode)
  --session=<name>   Name the session for branch/PR naming

Build Options
  --spec=<query>     Target spec(s) by name, slug, number, or comma-separated list
  --specs=<names>    Alias for --spec with comma-separated specs
  --all              Build all planned specs in order
  --iterations=<n>   Override max iteration count
  --verbose          Show full CLI output
  --transcript       Save session transcript to file
  --cli=<name>       Override AI CLI (claude, codex, opencode)
  --session=<name>   Name the session for branch/PR naming

Status Options
  --spec=<query>     Show status for a spec by name, slug, or number

Init Options
  --plan-cli=<name>    Set plan CLI (claude, codex, opencode)
  --plan-model=<id>    Set plan model
  --build-cli=<name>   Set build CLI (claude, codex, opencode)
  --build-model=<id>   Set build model
  --specs-dir=<path>   Set specs directory
  --verbose            Enable verbose output in config

Config Subcommands
  config             Interactive config editor
  config get <key>   Show a config value (dot-notation)
  config set <key> <value>  Set a config value
  config set <k>=<v> [<k>=<v>...]  Batch set config values
`,
	{
		importMeta: import.meta,
		flags: {
			spec: { type: "string" },
			specs: { type: "string" },
			all: { type: "boolean", default: false },
			iterations: { type: "number" },
			verbose: { type: "boolean", default: false },
			transcript: { type: "boolean" },
			cli: { type: "string" },
			planCli: { type: "string" },
			planModel: { type: "string" },
			buildCli: { type: "string" },
			buildModel: { type: "string" },
			specsDir: { type: "string" },
			session: { type: "string" },
		},
	},
);

ensureGlobalDir();

// Resolve --specs as alias for --spec (--specs takes precedence)
const resolvedSpec = cli.flags.specs ?? cli.flags.spec;
const flags = { ...cli.flags, spec: resolvedSpec };

interface CommandEntry {
	render: (
		f: typeof flags,
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
				session={flags.session}
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
				session={flags.session}
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
				verbose={flags.verbose}
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
			const [, subcommand, ...rest] = input;
			if (!subcommand) return <ConfigEditor version={version} />;
			if (subcommand === "set" && rest.some((arg) => arg.includes("="))) {
				return <ConfigSetBatch pairs={rest.filter((arg) => arg.includes("="))} />;
			}
			const [configKey, value] = rest;
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
	if (process.stdin.isTTY) {
		const app = render(<Welcome version={version} />);
		await app.waitUntilExit();
	} else {
		render(<Help version={version} />).unmount();
	}
} else if (command in commands) {
	const entry = commands[command];
	const app = render(entry.render(flags, cli.input, version));
	if (entry.waitForExit) {
		await app.waitUntilExit();
	} else {
		app.unmount();
	}
} else {
	render(<UnknownCommand command={command} />).unmount();
	process.exitCode = 1;
}
