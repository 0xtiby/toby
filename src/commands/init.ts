import fs from "node:fs";
import path from "node:path";
import chalk from "chalk";
import * as clack from "@clack/prompts";
import { detectAll, listModels } from "@0xtiby/spawner";
import { writeConfig } from "../lib/config.js";
import {
	getLocalDir,
	CONFIG_FILE,
	STATUS_FILE,
	DEFAULT_SPECS_DIR,
} from "../lib/paths.js";
import { CLI_NAMES } from "../types.js";
import type { CliName, TobyConfig } from "../types.js";
import { isTTY } from "../ui/tty.js";

export interface InitFlags {
	planCli?: string;
	planModel?: string;
	buildCli?: string;
	buildModel?: string;
	specsDir?: string;
	verbose?: boolean;
	force?: boolean;
}

interface CliDetection {
	installed: boolean;
	version: string | null;
	authenticated: boolean;
	binaryPath: string | null;
}

type DetectAllResult = Record<CliName, CliDetection>;

export interface InitSelections {
	planCli: CliName;
	planModel: string;
	buildCli: CliName;
	buildModel: string;
	specsDir: string;
	verbose: boolean;
}

export interface InitResult {
	configPath: string;
	statusCreated: boolean;
	specsDirCreated: boolean;
}

/** Create project files from wizard selections. Pure function, easily testable. */
export function createProject(
	selections: InitSelections,
	cwd: string = process.cwd(),
): InitResult {
	const localDir = getLocalDir(cwd);
	const configPath = path.join(localDir, CONFIG_FILE);
	const statusPath = path.join(localDir, STATUS_FILE);
	const specsPath = path.join(cwd, selections.specsDir);

	try {
		fs.mkdirSync(localDir, { recursive: true });
	} catch (err) {
		const msg =
			(err as NodeJS.ErrnoException).code === "EACCES"
				? `Permission denied creating ${localDir}`
				: `Failed to create project directory: ${(err as Error).message}`;
		throw new Error(msg);
	}

	try {
		const config: Partial<TobyConfig> = {
			plan: {
				cli: selections.planCli,
				model: selections.planModel,
				iterations: 2,
			},
			build: {
				cli: selections.buildCli,
				model: selections.buildModel,
				iterations: 10,
			},
			specsDir: selections.specsDir,
			verbose: selections.verbose,
			templateVars: {
				PRD_PATH: ".toby/{{SPEC_NAME}}.prd.json",
			},
		};
		writeConfig(config, configPath);
	} catch (err) {
		throw new Error(`Failed to write config: ${(err as Error).message}`);
	}

	const statusCreated = !fs.existsSync(statusPath);
	if (statusCreated) {
		try {
			fs.writeFileSync(
				statusPath,
				JSON.stringify({ specs: {} }, null, 2) + "\n",
			);
		} catch (err) {
			throw new Error(
				`Failed to write status file: ${(err as Error).message}`,
			);
		}
	}

	const specsDirCreated = !fs.existsSync(specsPath);
	if (specsDirCreated) {
		fs.mkdirSync(specsPath, { recursive: true });
	}

	return { configPath, statusCreated, specsDirCreated };
}

/** Filter detectAll results to only installed CLIs */
export function getInstalledClis(result: DetectAllResult): CliName[] {
	return (Object.entries(result) as [CliName, CliDetection][])
		.filter(([, info]) => info.installed)
		.map(([name]) => name);
}

/** Returns true when all 5 optional init flags are present (non-interactive mode). */
export function hasAllInitFlags(flags: InitFlags): boolean {
	return (
		flags.planCli !== undefined &&
		flags.planModel !== undefined &&
		flags.buildCli !== undefined &&
		flags.buildModel !== undefined &&
		flags.specsDir !== undefined
	);
}

function printSuccess(result: InitResult, selections: InitSelections): void {
	console.log(chalk.green.bold("✓ Project initialized!"));
	console.log(
		chalk.dim(`  created ${path.relative(process.cwd(), result.configPath)}`),
	);
	if (result.statusCreated) {
		console.log(chalk.dim("  created .toby/status.json"));
	}
	if (result.specsDirCreated) {
		console.log(chalk.dim(`  created ${selections.specsDir}/`));
	}
}

export async function runInit(flags: InitFlags): Promise<void> {
	if (hasAllInitFlags(flags)) {
		await runNonInteractive(flags);
		return;
	}

	if (!isTTY()) {
		console.error(
			`${chalk.red("✖")} toby init requires an interactive terminal.`,
		);
		console.error(
			"  Provide all flags: --planCli, --planModel, --buildCli, --buildModel, --specsDir",
		);
		console.error(
			"  Example: toby init --planCli claude --planModel default --buildCli claude --buildModel default --specsDir specs",
		);
		process.exitCode = 1;
		return;
	}

	await runInteractive(flags);
}

async function loadModelOptions(
	cli: CliName,
): Promise<{ value: string; label: string }[]> {
	try {
		const models = await listModels({ cli });
		return [
			{ value: "default", label: "default" },
			...models.map((m) => ({ value: m.id, label: `${m.name} (${m.id})` })),
		];
	} catch {
		return [{ value: "default", label: "default" }];
	}
}

function checkCancel(value: unknown): void {
	if (clack.isCancel(value)) {
		clack.cancel("Setup cancelled.");
		process.exit(0);
	}
}

async function runInteractive(flags: InitFlags): Promise<void> {
	clack.intro("toby init");

	// Check existing config
	const configPath = path.join(getLocalDir(), CONFIG_FILE);
	if (fs.existsSync(configPath) && !flags.force) {
		const overwrite = await clack.confirm({
			message: "Overwrite existing .toby/config.json?",
		});
		checkCancel(overwrite);
		if (!overwrite) {
			clack.cancel("Init cancelled.");
			return;
		}
	}

	// Detect CLIs
	const s = clack.spinner();
	s.start("Detecting installed CLIs...");
	const detectResult = (await detectAll()) as DetectAllResult;
	const installed = getInstalledClis(detectResult);
	s.stop("CLI detection complete.");

	if (installed.length === 0) {
		clack.cancel(
			"No AI CLIs found. Install one of:\n" +
				"  claude   — npm install -g @anthropic-ai/claude-code\n" +
				"  codex    — npm install -g @openai/codex\n" +
				"  opencode — go install github.com/opencode-ai/opencode@latest",
		);
		process.exitCode = 1;
		return;
	}

	const cliOptions = installed.map((name) => ({
		value: name,
		label: `${name} — ${detectResult[name]?.version ?? "unknown"}`,
	}));

	let planCli: CliName;
	let buildCli: CliName;

	if (installed.length === 1) {
		planCli = installed[0]!;
		buildCli = installed[0]!;
		clack.note(
			`Only ${planCli} is installed — auto-selected for plan and build.`,
			"CLI Selection",
		);
	} else {
		// Plan CLI
		const planCliResult = await clack.select({
			message: "Select CLI for planning",
			options: cliOptions,
		});
		checkCancel(planCliResult);
		planCli = planCliResult as CliName;

		// Build CLI
		const buildCliResult = await clack.select({
			message: "Select CLI for building",
			options: cliOptions,
		});
		checkCancel(buildCliResult);
		buildCli = buildCliResult as CliName;
	}

	// Plan model
	const planModelOptions = await loadModelOptions(planCli);
	const planModel = await clack.select({
		message: `Select model for planning (${planCli})`,
		options: planModelOptions,
	});
	checkCancel(planModel);

	// Build model
	const buildModelOptions = await loadModelOptions(buildCli);
	const buildModel = await clack.select({
		message: `Select model for building (${buildCli})`,
		options: buildModelOptions,
	});
	checkCancel(buildModel);

	// Specs directory
	const specsDir = await clack.text({
		message: "Specs directory",
		placeholder: DEFAULT_SPECS_DIR,
		defaultValue: DEFAULT_SPECS_DIR,
	});
	checkCancel(specsDir);

	// Verbose
	const verbose = await clack.confirm({
		message: "Enable verbose output?",
		initialValue: false,
	});
	checkCancel(verbose);

	const selections: InitSelections = {
		planCli,
		planModel: planModel as string,
		buildCli,
		buildModel: buildModel as string,
		specsDir: (specsDir as string).trim() || DEFAULT_SPECS_DIR,
		verbose: verbose as boolean,
	};

	try {
		const result = createProject(selections);
		clack.outro(
			`${chalk.green("Project initialized!")}\n` +
				chalk.dim(
					`  Config: ${path.relative(process.cwd(), result.configPath)}\n`,
				) +
				chalk.dim(`  Specs:  ${selections.specsDir}/`),
		);
	} catch (err) {
		clack.cancel(`Initialization failed: ${(err as Error).message}`);
		process.exitCode = 1;
	}
}

async function runNonInteractive(flags: InitFlags): Promise<void> {
	const planCli = flags.planCli!;
	const buildCli = flags.buildCli!;

	// Validate CLI names
	for (const cli of [planCli, buildCli]) {
		if (!(CLI_NAMES as readonly string[]).includes(cli)) {
			console.error(
				chalk.red(
					`✗ Unknown CLI: ${cli}. Must be one of: ${CLI_NAMES.join(", ")}`,
				),
			);
			process.exitCode = 1;
			return;
		}
	}

	// Check existing config
	const configPath = path.join(getLocalDir(), CONFIG_FILE);
	if (fs.existsSync(configPath) && !flags.force) {
		console.error(
			chalk.red("✗ .toby/config.json already exists."),
		);
		console.error(
			"  Pass --force to overwrite, or run interactively to confirm.",
		);
		process.exitCode = 1;
		return;
	}

	// Verify CLIs are installed
	const detectResult = (await detectAll()) as DetectAllResult;
	for (const cli of [planCli, buildCli]) {
		if (!detectResult[cli as CliName]?.installed) {
			console.error(chalk.red(`✗ CLI not installed: ${cli}`));
			process.exitCode = 1;
			return;
		}
	}

	const selections: InitSelections = {
		planCli: planCli as CliName,
		planModel: flags.planModel!,
		buildCli: buildCli as CliName,
		buildModel: flags.buildModel!,
		specsDir: flags.specsDir!,
		verbose: flags.verbose ?? false,
	};

	try {
		const result = createProject(selections);
		printSuccess(result, selections);
	} catch (err) {
		console.error(chalk.red(`✗ ${(err as Error).message}`));
		process.exitCode = 1;
	}
}
