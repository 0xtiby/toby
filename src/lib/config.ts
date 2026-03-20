import fs from "node:fs";
import path from "node:path";
import { ConfigSchema, CLI_NAMES } from "../types.js";
import type { TobyConfig, CommandConfig } from "../types.js";
import { getGlobalDir, getLocalDir, CONFIG_FILE } from "./paths.js";

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

/** Load global config from ~/.toby/config.json */
export function loadGlobalConfig(): Partial<TobyConfig> {
	return readConfigFile(path.join(getGlobalDir(), CONFIG_FILE));
}

/** Load local config from <cwd>/.toby/config.json */
export function loadLocalConfig(cwd?: string): Partial<TobyConfig> {
	return readConfigFile(path.join(getLocalDir(cwd), CONFIG_FILE));
}

/** Deep-merge two partial configs, with local overriding global for nested command objects */
export function mergeConfigs(
	global: Partial<TobyConfig>,
	local: Partial<TobyConfig>,
): Partial<TobyConfig> {
	const merged: Record<string, unknown> = { ...global };

	for (const [key, value] of Object.entries(local)) {
		if (
			typeof value === "object" &&
			value !== null &&
			!Array.isArray(value) &&
			typeof merged[key] === "object" &&
			merged[key] !== null &&
			!Array.isArray(merged[key])
		) {
			merged[key] = { ...(merged[key] as Record<string, unknown>), ...value };
		} else {
			merged[key] = value;
		}
	}

	return merged as Partial<TobyConfig>;
}

/** Load, merge, and validate config from global + local sources */
export function loadConfig(cwd?: string): TobyConfig {
	const global = loadGlobalConfig();
	const local = loadLocalConfig(cwd);
	const merged = mergeConfigs(global, local);
	return ConfigSchema.parse(merged);
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
		throw new Error(`Unknown CLI: ${cli}. Must be one of: ${CLI_NAMES.join(", ")}`);
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
		templateVars: base.templateVars ?? {},
	};
}
