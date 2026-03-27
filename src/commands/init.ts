import fs from "node:fs";
import path from "node:path";
import chalk from "chalk";
import { detectAll } from "@0xtiby/spawner";
import { writeConfig } from "../lib/config.js";
import {
	getLocalDir,
	CONFIG_FILE,
	STATUS_FILE,
	DEFAULT_SPECS_DIR,
} from "../lib/paths.js";
import { CLI_NAMES } from "../types.js";
import type { TobyConfig, CliName } from "../types.js";
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

	// Interactive mode — implemented in next task
	console.log("Interactive mode not yet implemented.");
	console.log(
		"Provide all flags: toby init --planCli claude --planModel default --buildCli claude --buildModel default --specsDir specs",
	);
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
