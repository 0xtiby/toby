import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { runClean } from "./clean.js";

vi.mock("../lib/clean.js", () => ({
	listTranscripts: vi.fn(),
	executeClean: vi.fn(),
}));

vi.mock("../ui/prompt.js", () => ({
	confirmAction: vi.fn(),
}));

vi.mock("../ui/tty.js", () => ({
	isTTY: vi.fn(),
}));

import { listTranscripts, executeClean } from "../lib/clean.js";
import { confirmAction } from "../ui/prompt.js";
import { isTTY } from "../ui/tty.js";

let logOutput: string[];
let errorOutput: string[];

beforeEach(() => {
	logOutput = [];
	errorOutput = [];
	vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
		logOutput.push(args.map(String).join(" "));
	});
	vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
		errorOutput.push(args.map(String).join(" "));
	});
	vi.mocked(isTTY).mockReturnValue(true);
	process.exitCode = undefined;
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe("runClean", () => {
	it("prints message when 0 transcripts", async () => {
		vi.mocked(listTranscripts).mockReturnValue([]);
		await runClean({});
		expect(logOutput.join("\n")).toContain("No transcripts to clean.");
	});

	it("deletes without prompt when --force", async () => {
		vi.mocked(listTranscripts).mockReturnValue(["/tmp/a.md", "/tmp/b.md"]);
		vi.mocked(executeClean).mockReturnValue({ deleted: 2, failed: 0, total: 2 });
		await runClean({ force: true });
		expect(confirmAction).not.toHaveBeenCalled();
		expect(logOutput.join("\n")).toContain("Deleted 2 transcript files.");
	});

	it("errors in non-TTY without --force", async () => {
		vi.mocked(listTranscripts).mockReturnValue(["/tmp/a.md"]);
		vi.mocked(isTTY).mockReturnValue(false);
		await runClean({});
		expect(errorOutput.join("\n")).toContain("--force");
		expect(process.exitCode).toBe(1);
	});

	it("deletes after TTY confirmation", async () => {
		vi.mocked(listTranscripts).mockReturnValue(["/tmp/a.md", "/tmp/b.md", "/tmp/c.md"]);
		vi.mocked(confirmAction).mockResolvedValue(true);
		vi.mocked(executeClean).mockReturnValue({ deleted: 3, failed: 0, total: 3 });
		await runClean({});
		expect(confirmAction).toHaveBeenCalled();
		expect(logOutput.join("\n")).toContain("Found 3 transcript files.");
		expect(logOutput.join("\n")).toContain("Deleted 3 transcript files.");
	});

	it("cancels when user declines confirmation", async () => {
		vi.mocked(listTranscripts).mockReturnValue(["/tmp/a.md"]);
		vi.mocked(confirmAction).mockResolvedValue(false);
		await runClean({});
		expect(logOutput.join("\n")).toContain("Clean cancelled.");
		expect(executeClean).not.toHaveBeenCalled();
	});

	it("reports partial failures", async () => {
		vi.mocked(listTranscripts).mockReturnValue(["/tmp/a.md", "/tmp/b.md"]);
		vi.mocked(executeClean).mockReturnValue({ deleted: 1, failed: 1, total: 2 });
		await runClean({ force: true });
		const text = logOutput.join("\n");
		expect(text).toContain("Deleted 1 transcript files");
		expect(text).toContain("Failed to delete 1 files");
	});
});
