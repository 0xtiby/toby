import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

/** Global config directory: ~/.toby */
export const GLOBAL_TOBY_DIR = ".toby";

/** Local config directory relative to project root */
export const LOCAL_TOBY_DIR = ".toby";

/** Default specs directory name */
export const DEFAULT_SPECS_DIR = "specs";

/** PRD output directory relative to local config */
export const PRD_DIR = "prd";

/** Status file name */
export const STATUS_FILE = "status.json";

/** Config file name */
export const CONFIG_FILE = "config.json";

/** Returns absolute path to ~/.toby */
export function getGlobalDir(): string {
	return path.join(os.homedir(), GLOBAL_TOBY_DIR);
}

/** Returns absolute path to <cwd>/.toby */
export function getLocalDir(cwd?: string): string {
	return path.join(cwd ?? process.cwd(), LOCAL_TOBY_DIR);
}

/** Shipped prompts directory (relative to package root) */
function getShippedPromptsDir(): string {
	const thisFile = fileURLToPath(import.meta.url);
	// src/lib/paths.ts -> package root is ../../
	return path.resolve(path.dirname(thisFile), "..", "..", "prompts");
}

/**
 * Resolve a prompt file through the 3-level chain:
 * 1. Local .toby/<name> (project override)
 * 2. Global ~/.toby/<name> (user override)
 * 3. Shipped prompts/<name> (package default)
 *
 * Returns the first existing path, or undefined if none found.
 */
export function getPromptPath(
	name: string,
	cwd?: string,
): string | undefined {
	const candidates = [
		path.join(getLocalDir(cwd), name),
		path.join(getGlobalDir(), name),
		path.join(getShippedPromptsDir(), name),
	];

	for (const candidate of candidates) {
		if (fs.existsSync(candidate)) {
			return candidate;
		}
	}

	return undefined;
}
