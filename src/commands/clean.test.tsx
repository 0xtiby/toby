import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render } from "ink-testing-library";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import Clean, { executeClean } from "./clean.js";

function delay(ms = 100): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

let tmpDir: string;
let originalIsTTY: boolean | undefined;

function setup(opts: { fileCount?: number; tty?: boolean } = {}) {
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "toby-clean-cmd-test-"));
	const transcriptsDir = path.join(tmpDir, ".toby", "transcripts");

	if (opts.fileCount && opts.fileCount > 0) {
		fs.mkdirSync(transcriptsDir, { recursive: true });
		for (let i = 0; i < opts.fileCount; i++) {
			fs.writeFileSync(path.join(transcriptsDir, `transcript-${i}.md`), "content");
		}
	}

	vi.spyOn(process, "cwd").mockReturnValue(tmpDir);

	if (opts.tty !== undefined) {
		Object.defineProperty(process.stdin, "isTTY", {
			value: opts.tty,
			writable: true,
			configurable: true,
		});
	}
}

beforeEach(() => {
	tmpDir = "";
	originalIsTTY = process.stdin.isTTY;
});

afterEach(() => {
	vi.restoreAllMocks();
	Object.defineProperty(process.stdin, "isTTY", {
		value: originalIsTTY,
		writable: true,
		configurable: true,
	});
	if (tmpDir && fs.existsSync(tmpDir)) {
		fs.rmSync(tmpDir, { recursive: true });
	}
});

describe("executeClean", () => {
	it("returns zeros when no transcripts exist", () => {
		setup();
		const result = executeClean();
		expect(result).toEqual({ deleted: 0, failed: 0, total: 0 });
	});

	it("deletes all transcripts and returns counts", () => {
		setup({ fileCount: 3 });
		const result = executeClean();
		expect(result).toEqual({ deleted: 3, failed: 0, total: 3 });

		const transcriptsDir = path.join(tmpDir, ".toby", "transcripts");
		expect(fs.readdirSync(transcriptsDir)).toHaveLength(0);
	});
});

describe("Clean component", () => {
	it("renders 'No transcripts to clean.' when directory doesn't exist", () => {
		setup();
		const { lastFrame } = render(<Clean />);
		expect(lastFrame()).toContain("No transcripts to clean.");
	});

	it("renders 'No transcripts to clean.' when directory is empty", () => {
		setup();
		fs.mkdirSync(path.join(tmpDir, ".toby", "transcripts"), { recursive: true });
		const { lastFrame } = render(<Clean />);
		expect(lastFrame()).toContain("No transcripts to clean.");
	});

	it("renders file count and confirmation prompt when files exist", () => {
		setup({ fileCount: 5, tty: true });
		const { lastFrame } = render(<Clean />);
		expect(lastFrame()).toContain("Found 5 transcript files. Delete all? [Y/n]");
	});

	it("renders deletion summary when --force is passed", () => {
		setup({ fileCount: 3 });
		const { lastFrame } = render(<Clean force />);
		expect(lastFrame()).toContain("Deleted 3 transcript files.");
	});

	it("renders 'Clean cancelled.' when user presses n", async () => {
		setup({ fileCount: 2, tty: true });
		const { lastFrame, stdin } = render(<Clean />);
		expect(lastFrame()).toContain("Delete all?");
		await delay();
		stdin.write("n");
		await delay();
		expect(lastFrame()).toContain("Clean cancelled.");
	});

	it("renders deletion summary when user presses y", async () => {
		setup({ fileCount: 2, tty: true });
		const { lastFrame, stdin } = render(<Clean />);
		expect(lastFrame()).toContain("Delete all?");
		await delay();
		stdin.write("y");
		await delay();
		expect(lastFrame()).toContain("Deleted 2 transcript files.");
	});

	it("renders error in non-TTY mode without --force", () => {
		setup({ fileCount: 2, tty: false });
		const { lastFrame } = render(<Clean />);
		expect(lastFrame()).toContain("Error: Use --force to clean transcripts in non-interactive mode.");
	});

	it("deletes transcripts in non-TTY mode with --force", () => {
		setup({ fileCount: 2, tty: false });
		const { lastFrame } = render(<Clean force />);
		expect(lastFrame()).toContain("Deleted 2 transcript files.");
	});
});
