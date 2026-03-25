import path from "node:path";
import fs from "node:fs";
import { getLocalDir, TRANSCRIPTS_DIR } from "./paths.js";

export interface CleanResult {
	deleted: number;
	failed: number;
	total: number;
}

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

export function deleteTranscripts(files: string[]): number {
	let deleted = 0;
	for (const file of files) {
		try {
			fs.unlinkSync(file);
			deleted++;
		} catch {
			// intentionally empty — skip individual file errors
		}
	}
	return deleted;
}

export function executeClean(cwd?: string): CleanResult {
	const files = listTranscripts(cwd);
	if (files.length === 0) {
		return { deleted: 0, failed: 0, total: 0 };
	}
	const deleted = deleteTranscripts(files);
	return { deleted, failed: files.length - deleted, total: files.length };
}
