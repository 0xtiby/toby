import fs from "node:fs";
import path from "node:path";
import type { CliEvent } from "@0xtiby/spawner";
import { getLocalDir } from "./paths.js";

const TRANSCRIPTS_DIR = "transcripts";

export interface TranscriptOptions {
	command: string;
	specName?: string;
	session?: string;
	verbose: boolean;
}

export interface IterationMeta {
	iteration: number;
	total: number;
	cli: string;
	model: string;
}

export interface TranscriptWriter {
	writeEvent(event: CliEvent): void;
	writeIterationHeader(meta: IterationMeta): void;
	writeSpecHeader(specIndex: number, totalSpecs: number, specName: string): void;
	close(): void;
	readonly filePath: string;
}

function formatTimestamp(): string {
	const now = new Date();
	const pad = (n: number, len = 2) => String(n).padStart(len, "0");
	return [
		now.getFullYear(),
		pad(now.getMonth() + 1),
		pad(now.getDate()),
		"-",
		pad(now.getHours()),
		pad(now.getMinutes()),
		pad(now.getSeconds()),
		"-",
		pad(now.getMilliseconds(), 3),
	].join("");
}

function formatEventPlaintext(event: CliEvent, verbose: boolean): string | null {
	if (event.type === "done") return null;

	if (!verbose) {
		if (event.type !== "text") return null;
		return event.content ?? "";
	}

	switch (event.type) {
		case "text":
			return `[text] ${event.content ?? ""}`;
		case "tool_use":
			return `[tool_use] ${event.tool?.name ?? "tool"} ${JSON.stringify(event.tool?.input ?? {})}`;
		case "tool_result":
			return `[tool_result] ${(event.content ?? "").slice(0, 200)}`;
		case "error":
			return `[error] ${event.content ?? ""}`;
		case "system":
			return `[system] ${event.content ?? ""}`;
		default:
			return `[${event.type}] ${event.content ?? ""}`;
	}
}

export function openTranscript(options: TranscriptOptions): TranscriptWriter {
	const { command, specName, session, verbose } = options;
	const prefix = session ?? specName ?? "all";
	const timestamp = formatTimestamp();
	const filename = `${prefix}-${command}-${timestamp}.md`;

	const transcriptsDir = path.join(getLocalDir(), TRANSCRIPTS_DIR);
	fs.mkdirSync(transcriptsDir, { recursive: true });

	const filePath = path.join(transcriptsDir, filename);

	const header = [
		"---",
		`command: ${command}`,
		`session: ${session ?? ""}`,
		`spec: ${specName ?? ""}`,
		`verbose: ${verbose}`,
		`created: ${new Date().toISOString()}`,
		"---",
		"",
		`# Transcript: ${prefix} ${command}`,
		"",
	].join("\n");

	try {
		fs.writeFileSync(filePath, header);
	} catch (err) {
		console.error(`Warning: could not create transcript file: ${(err as Error).message}`);
	}

	const stream = fs.createWriteStream(filePath, { flags: "a" });

	stream.on("error", (err) => {
		console.error(`Warning: transcript write error: ${err.message}`);
	});

	return {
		filePath,

		writeEvent(event: CliEvent): void {
			const line = formatEventPlaintext(event, verbose);
			if (line === null) return;
			try {
				stream.write(line + "\n");
			} catch (err) {
				console.error(`Warning: transcript write error: ${(err as Error).message}`);
			}
		},

		writeIterationHeader(meta: IterationMeta): void {
			const ts = new Date().toISOString();
			const header = `\n## Iteration ${meta.iteration}/${meta.total}\n\ncli: ${meta.cli} | model: ${meta.model} | started: ${ts}\n\n`;
			try {
				stream.write(header);
			} catch (err) {
				console.error(`Warning: transcript write error: ${(err as Error).message}`);
			}
		},

		writeSpecHeader(specIndex: number, totalSpecs: number, specName: string): void {
			const header = `\n## Spec ${specIndex}/${totalSpecs}: ${specName}\n\n`;
			try {
				stream.write(header);
			} catch (err) {
				console.error(`Warning: transcript write error: ${(err as Error).message}`);
			}
		},

		close(): void {
			try {
				stream.end();
			} catch (err) {
				console.error(`Warning: transcript close error: ${(err as Error).message}`);
			}
		},
	};
}
