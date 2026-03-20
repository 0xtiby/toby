import fs from "node:fs";
import path from "node:path";
import { ConfigSchema } from "../types.js";
import type { TobyConfig } from "../types.js";
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
			(key === "plan" || key === "build") &&
			typeof value === "object" &&
			value !== null &&
			typeof merged[key] === "object" &&
			merged[key] !== null
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
