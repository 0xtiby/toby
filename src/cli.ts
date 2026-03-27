#!/usr/bin/env node
import { createRequire } from "node:module";
import { Command } from "commander";
import { ensureGlobalDir } from "./lib/paths.js";

const require = createRequire(import.meta.url);
const { version } = require("../package.json") as { version: string };

const program = new Command()
	.name("toby")
	.description("AI-assisted development loop engine")
	.version(version)
	.showSuggestionAfterError(true)
	.showHelpAfterError(true);

program
	.command("plan")
	.description("Plan specs with AI loop engine")
	.option("--spec <name>", "Spec name or number")
	.option("--specs <name>", "Alias for --spec")
	.option("--all", "Plan all pending specs")
	.option("--verbose", "Show all events")
	.option("--cli <cli>", "Override CLI tool")
	.option("--iterations <n>", "Max iterations", parseInt)
	.option("--transcript", "Enable transcript recording")
	.option("--session <name>", "Name the session")
	.action(async (opts) => {
		const { executePlan, executePlanAll } = await import("./commands/plan.js");
		const spec = opts.specs ?? opts.spec;
		const flags = {
			spec,
			all: opts.all ?? false,
			verbose: opts.verbose ?? false,
			transcript: opts.transcript,
			iterations: opts.iterations,
			cli: opts.cli,
			session: opts.session,
		};

		if (opts.all) {
			await executePlanAll(flags);
		} else {
			await executePlan(flags);
		}
	});

ensureGlobalDir();

// No subcommand → show help (exit 0)
if (process.argv.length <= 2) {
	program.help();
}

program.parse();
