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

export class TranscriptWriter {
	readonly filePath: string;
	private stream: fs.WriteStream;
	private verbose: boolean;

	constructor(filePath: string, stream: fs.WriteStream, verbose: boolean) {
		this.filePath = filePath;
		this.stream = stream;
		this.verbose = verbose;
	}

	writeEvent(event: CliEvent): void {
		const line = formatEventPlaintext(event, this.verbose);
		if (line === null) return;
		this.stream.write(line + "\n");
	}

	writeIterationHeader(meta: IterationMeta): void {
		const ts = new Date().toISOString();
		const header = `\n## Iteration ${meta.iteration}/${meta.total}\n\ncli: ${meta.cli} | model: ${meta.model} | started: ${ts}\n\n`;
		this.stream.write(header);
	}

	writeSpecHeader(specIndex: number, totalSpecs: number, specName: string): void {
		const header = `\n## Spec ${specIndex}/${totalSpecs}: ${specName}\n\n`;
		this.stream.write(header);
	}

	close(): void {
		try {
			this.stream.end();
		} catch (err) {
			console.error(`Warning: transcript close error: ${(err as Error).message}`);
		}
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

	return new TranscriptWriter(filePath, stream, verbose);
}

export interface WithTranscriptOptions {
	flags: { transcript?: boolean; session?: string; verbose?: boolean };
	config: { transcript?: boolean; verbose: boolean };
	command: string;
	specName?: string;
}

export async function withTranscript<T>(
	options: WithTranscriptOptions,
	externalWriter: TranscriptWriter | null | undefined,
	fn: (writer: TranscriptWriter | null) => Promise<T>,
): Promise<T> {
	const owns = externalWriter === undefined;
	const writer = externalWriter !== undefined
		? externalWriter
		: (options.flags.transcript ?? options.config.transcript)
			? openTranscript({
				command: options.command,
				specName: options.specName,
				session: options.flags.session,
				verbose: options.flags.verbose || options.config.verbose,
			})
			: null;

	try {
		return await fn(writer);
	} finally {
		if (owns) writer?.close();
	}
}
