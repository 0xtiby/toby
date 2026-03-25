import path from "node:path";
import fs from "node:fs";
import { getLocalDir, TRANSCRIPTS_DIR } from "./paths.js";

/**
 * List all transcript files in .toby/transcripts/.
 * Returns absolute paths. Returns empty array if directory doesn't exist.
 */
export function listTranscripts(cwd?: string): string[] {
	const dir = path.join(getLocalDir(cwd), TRANSCRIPTS_DIR);

	let entries: fs.Dirent[];
	try {
		entries = fs.readdirSync(dir, { withFileTypes: true });
	} catch {
		return [];
	}

	return entries
		.filter((e) => e.isFile())
		.map((e) => path.join(dir, e.name));
}

/**
 * Delete the given transcript files.
 * Returns the number of successfully deleted files.
 * Continues on individual file errors.
 */
export function deleteTranscripts(files: string[]): number {
	let deleted = 0;
	for (const file of files) {
		try {
			fs.unlinkSync(file);
			deleted++;
		} catch {
			// continue on individual file errors
		}
	}
	return deleted;
}
