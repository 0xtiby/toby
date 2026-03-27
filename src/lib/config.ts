import fs from "node:fs";
import path from "node:path";
import { ConfigSchema, CLI_NAMES } from "../types.js";
import type { TobyConfig, CommandConfig } from "../types.js";
import { getLocalDir, CONFIG_FILE } from "./paths.js";
import { formatErrorWithHint } from "./help.js";

/**
 * Read and parse a JSON config file, returning a partial config.
 * Returns {} if file is missing or corrupted.
 */
function readConfigFile(filePath: string): Record<string, unknown> {
	try {
		const content = fs.readFileSync(filePath, "utf-8");
		return JSON.parse(content) as Record<string, unknown>;
	} catch {
		if (fs.existsSync(filePath)) {
			console.warn(`Warning: corrupted config at ${filePath}, ignoring`);
		}
		return {};
	}
}

/** Load local config from <cwd>/.toby/config.json */
export function loadLocalConfig(cwd?: string): Partial<TobyConfig> {
	return readConfigFile(path.join(getLocalDir(cwd), CONFIG_FILE));
}

/** Load and validate config from local .toby/config.json + Zod defaults */
export function loadConfig(cwd?: string): TobyConfig {
	const local = loadLocalConfig(cwd);
	return ConfigSchema.parse(local);
}

/**
 * Write a partial config object to a JSON file.
 * Creates parent directories if they don't exist.
 */
export function writeConfig(
	config: Partial<TobyConfig>,
	filePath: string,
): void {
	const dir = path.dirname(filePath);
	fs.mkdirSync(dir, { recursive: true });
	fs.writeFileSync(filePath, JSON.stringify(config, null, 2) + "\n");
}

/** CLI flag overrides for command config */
export interface CommandFlags {
	cli?: "claude" | "codex" | "opencode";
	model?: string;
	iterations?: number;
}

/**
 * Validate a CLI name against the known list.
 * Throws a user-friendly error if the CLI name is invalid.
 */
export function validateCliName(cli: string | undefined): void {
	if (cli && !(CLI_NAMES as readonly string[]).includes(cli)) {
		throw new Error(
			formatErrorWithHint(
				`Unknown CLI: ${cli}`,
				[...CLI_NAMES],
				"toby plan --cli=claude --spec=auth",
			),
		);
	}
}

/** Resolve final command config by applying CLI flags over config values */
export function resolveCommandConfig(
	config: TobyConfig,
	command: "plan" | "build",
	flags: CommandFlags = {},
): CommandConfig {
	validateCliName(flags.cli);
	const base = config[command];

	return {
		cli: flags.cli ?? base.cli,
		model: flags.model || base.model || "default",
		iterations: flags.iterations ?? base.iterations,
	};
}
