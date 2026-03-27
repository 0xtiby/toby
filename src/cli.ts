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

// ── Shared flag helpers ─────────────────────────────────────────
function specOptions(cmd: Command): Command {
	return cmd
		.option("--spec <name>", "Spec name or number")
		.option("--specs <name>", "Alias for --spec")
		.option("--all", "Plan all pending specs")
		.option("--verbose", "Show all events")
		.option("--cli <cli>", "Override CLI tool")
		.option("--iterations <n>", "Max iterations", parseInt)
		.option("--transcript", "Enable transcript recording")
		.option("--session <name>", "Name the session");
}

function resolveSpecFlags(opts: Record<string, unknown>) {
	return {
		spec: (opts.specs ?? opts.spec) as string | undefined,
		all: (opts.all as boolean) ?? false,
		verbose: (opts.verbose as boolean) ?? false,
		transcript: opts.transcript as boolean | undefined,
		iterations: opts.iterations as number | undefined,
		cli: opts.cli as string | undefined,
		session: opts.session as string | undefined,
	};
}

// ── plan ────────────────────────────────────────────────────────
specOptions(program.command("plan").description("Plan specs with AI loop engine"))
	.action(async (opts) => {
		const { executePlan, executePlanAll } = await import("./commands/plan.js");
		const flags = resolveSpecFlags(opts);
		if (flags.all) {
			await executePlanAll(flags);
		} else {
			await executePlan(flags);
		}
	});

// ── build ───────────────────────────────────────────────────────
specOptions(program.command("build").description("Build tasks one-per-spawn with AI"))
	.action(async (opts) => {
		const { executeBuild, executeBuildAll } = await import("./commands/build.js");
		const flags = resolveSpecFlags(opts);
		if (flags.all) {
			await executeBuildAll(flags);
		} else {
			await executeBuild(flags);
		}
	});

// ── resume ──────────────────────────────────────────────────────
program
	.command("resume")
	.description("Resume an interrupted build session")
	.option("--iterations <n>", "Max iterations", parseInt)
	.option("--verbose", "Show all events")
	.option("--transcript", "Enable transcript recording")
	.action(async (opts) => {
		const { executeResume } = await import("./commands/resume.js");
		await executeResume({
			iterations: opts.iterations,
			verbose: opts.verbose,
			transcript: opts.transcript,
		});
	});

// ── init ────────────────────────────────────────────────────────
program
	.command("init")
	.description("Initialize toby in current project")
	.option("--plan-cli <name>", "Set plan CLI (claude, codex, opencode)")
	.option("--plan-model <id>", "Set plan model")
	.option("--build-cli <name>", "Set build CLI (claude, codex, opencode)")
	.option("--build-model <id>", "Set build model")
	.option("--specs-dir <path>", "Set specs directory")
	.option("--verbose", "Enable verbose output")
	.option("--force", "Force re-initialization")
	.action(async (opts) => {
		const { runInit } = await import("./commands/init.js");
		await runInit({
			version,
			planCli: opts.planCli,
			planModel: opts.planModel,
			buildCli: opts.buildCli,
			buildModel: opts.buildModel,
			specsDir: opts.specsDir,
			verbose: opts.verbose,
			force: opts.force,
		});
	});

// ── status ──────────────────────────────────────────────────────
program
	.command("status")
	.description("Show project status")
	.option("--spec <name>", "Show status for a specific spec")
	.action(async (opts) => {
		const { runStatus } = await import("./commands/status.js");
		await runStatus({ spec: opts.spec, version });
	});

// ── config ──────────────────────────────────────────────────────
program
	.command("config")
	.description("Manage configuration")
	.argument("[subcommand]", "get or set")
	.argument("[args...]", "key and value(s)")
	.action(async (subcommand: string | undefined, args: string[], opts) => {
		const { runConfig } = await import("./commands/config.js");
		await runConfig({
			subcommand,
			args,
			version,
			...opts,
		});
	});

// ── clean ───────────────────────────────────────────────────────
program
	.command("clean")
	.description("Delete session transcripts")
	.option("--force", "Skip confirmation prompt")
	.action(async (opts) => {
		const { runClean } = await import("./commands/clean.js");
		await runClean({ force: opts.force });
	});

ensureGlobalDir();

// No subcommand → welcome screen (TTY) or help text (non-TTY)
if (process.argv.length <= 2) {
	const { runWelcome } = await import("./commands/welcome.js");
	await runWelcome(version);
	process.exit(0);
}

program.parse();
