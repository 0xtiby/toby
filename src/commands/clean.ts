import chalk from "chalk";
import { listTranscripts, executeClean } from "../lib/clean.js";
import { confirmAction } from "../ui/prompt.js";
import { isTTY } from "../ui/tty.js";

export interface RunCleanOptions {
	force?: boolean;
}

export async function runClean({ force }: RunCleanOptions): Promise<void> {
	const files = listTranscripts();

	if (files.length === 0) {
		console.log("No transcripts to clean.");
		return;
	}

	if (!isTTY() && !force) {
		console.error(
			chalk.red("Error: Use --force to delete transcripts in non-interactive mode."),
		);
		process.exitCode = 1;
		return;
	}

	if (!force) {
		console.log(`Found ${files.length} transcript files.`);
		const confirmed = await confirmAction("Delete all transcripts?");
		if (!confirmed) {
			console.log("Clean cancelled.");
			return;
		}
	}

	const result = executeClean();

	if (result.failed > 0) {
		console.log(
			`Deleted ${result.deleted} transcript files. Failed to delete ${result.failed} files.`,
		);
	} else {
		console.log(`Deleted ${result.deleted} transcript files.`);
	}
}
