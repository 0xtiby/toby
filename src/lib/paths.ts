import path from "node:path";
import fs from "node:fs";

/** Local config directory relative to project root */
export const LOCAL_TOBY_DIR = ".toby";

/** Default specs directory name */
export const DEFAULT_SPECS_DIR = "specs";

/** Status file name */
export const STATUS_FILE = "status.json";

/** Config file name */
export const CONFIG_FILE = "config.json";

/** Transcripts subdirectory name inside .toby/ */
export const TRANSCRIPTS_DIR = "transcripts";

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
