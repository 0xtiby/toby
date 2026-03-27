import meow from "meow";
import React from "react";
import { render } from "ink";
import Plan from "./commands/plan.js";
import Build from "./commands/build.js";
import Init from "./commands/init.js";
import Status from "./commands/status.js";
import Config, { ConfigEditor, ConfigSetBatch } from "./commands/config.js";
import Clean from "./commands/clean.js";
import Resume from "./commands/resume.js";
import Welcome from "./components/Welcome.js";
import {
	formatGlobalHelp,
	formatCommandHelp,
	formatErrorWithHint,
	commandHelp,
} from "./lib/help.js";
import { COMMAND_NAMES, MEOW_FLAGS, normalizeBooleanFlags } from "./lib/cli-meta.js";

function writeUnknownCommandError(command: string): void {
	process.stderr.write(
		formatErrorWithHint(
			`Unknown command: ${command}`,
			COMMAND_NAMES,
			"toby --help",
		),
	);
}

const cli = meow("", {
	importMeta: import.meta,
	autoHelp: false,
	flags: MEOW_FLAGS,
});

// Resolve --specs as alias for --spec (--specs takes precedence)
const resolvedSpec = cli.flags.specs ?? cli.flags.spec;

const normalized = normalizeBooleanFlags(cli.flags, process.argv.slice(2));
const flags = { ...normalized, spec: resolvedSpec };

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
				transcript={flags.transcript}
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
				transcript={flags.transcript}
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
	resume: {
		render: (flags) => (
			<Resume
				iterations={flags.iterations}
				verbose={flags.verbose}
				transcript={flags.transcript}
			/>
		),
		waitForExit: true,
	},
	clean: {
		render: (flags) => <Clean force={flags.force} />,
		waitForExit: true,
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

// --help takes precedence over everything
if (cli.flags.help) {
	if (!command || command in commands) {
		if (command && command in commandHelp) {
			process.stdout.write(formatCommandHelp(command, commandHelp[command]));
		} else {
			process.stdout.write(formatGlobalHelp(version));
		}
		process.exitCode = 0;
	} else {
		writeUnknownCommandError(command);
		process.exitCode = 1;
	}
} else if (!command) {
	if (process.stdin.isTTY) {
		const app = render(<Welcome version={version} />);
		await app.waitUntilExit();
	} else {
		process.stdout.write(formatGlobalHelp(version));
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
	writeUnknownCommandError(command);
	process.exitCode = 1;
}
