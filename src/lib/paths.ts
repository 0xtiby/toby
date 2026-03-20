import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { ConfigSchema } from "../types.js";

/** Global config directory: ~/.toby */
export const GLOBAL_TOBY_DIR = ".toby";

/** Local config directory relative to project root */
export const LOCAL_TOBY_DIR = ".toby";

/** Default specs directory name */
export const DEFAULT_SPECS_DIR = "specs";

/** Status file name */
export const STATUS_FILE = "status.json";

/** Config file name */
export const CONFIG_FILE = "config.json";

/** Returns absolute path to ~/.toby */
export function getGlobalDir(): string {
	return path.join(os.homedir(), GLOBAL_TOBY_DIR);
}

/**
 * Ensure ~/.toby/ exists with default config.json.
 * Warns and continues if the directory is not writable.
 */
export function ensureGlobalDir(): void {
	const dir = getGlobalDir();
	const configPath = path.join(dir, CONFIG_FILE);

	try {
		fs.mkdirSync(dir, { recursive: true });

		if (!fs.existsSync(configPath)) {
			const defaults = ConfigSchema.parse({});
			fs.writeFileSync(configPath, JSON.stringify(defaults, null, 2) + "\n");
		}
	} catch (err) {
		console.warn(
			`Warning: could not initialize ${dir}: ${(err as Error).message}`,
		);
	}
}

/** Returns absolute path to <cwd>/.toby */
export function getLocalDir(cwd?: string): string {
	return path.join(cwd ?? process.cwd(), LOCAL_TOBY_DIR);
}

/**
 * Ensure local .toby/ exists with status.json.
 * Called on first plan/build if missing.
 * Returns the absolute path to the local .toby directory.
 */
export function ensureLocalDir(cwd?: string): string {
	const dir = getLocalDir(cwd);
	const statusPath = path.join(dir, STATUS_FILE);

	fs.mkdirSync(dir, { recursive: true });

	if (!fs.existsSync(statusPath)) {
		fs.writeFileSync(statusPath, JSON.stringify({ specs: {} }, null, 2) + "\n");
	}

	return dir;
}
