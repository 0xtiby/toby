import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { listTranscripts, deleteTranscripts } from "../clean.js";

let tmpDir: string;

beforeEach(() => {
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "toby-clean-test-"));
	vi.spyOn(process, "cwd").mockReturnValue(tmpDir);
});

afterEach(() => {
	vi.restoreAllMocks();
	fs.rmSync(tmpDir, { recursive: true, force: true });
});

function createTranscriptsDir(): string {
	const dir = path.join(tmpDir, ".toby", "transcripts");
	fs.mkdirSync(dir, { recursive: true });
	return dir;
}

describe("listTranscripts", () => {
	it("returns empty array when .toby/transcripts/ doesn't exist", () => {
		expect(listTranscripts()).toEqual([]);
	});

	it("returns empty array when directory is empty", () => {
		createTranscriptsDir();
		expect(listTranscripts()).toEqual([]);
	});

	it("returns absolute paths of all files in directory", () => {
		const dir = createTranscriptsDir();
		fs.writeFileSync(path.join(dir, "a.md"), "content");
		fs.writeFileSync(path.join(dir, "b.md"), "content");

		const result = listTranscripts();
		expect(result).toHaveLength(2);
		expect(result).toContain(path.join(dir, "a.md"));
		expect(result).toContain(path.join(dir, "b.md"));
	});

	it("does not include subdirectories in results", () => {
		const dir = createTranscriptsDir();
		fs.writeFileSync(path.join(dir, "a.md"), "content");
		fs.mkdirSync(path.join(dir, "subdir"));

		const result = listTranscripts();
		expect(result).toHaveLength(1);
		expect(result[0]).toContain("a.md");
	});

	it("accepts explicit cwd parameter", () => {
		vi.restoreAllMocks(); // clear the process.cwd mock
		const dir = path.join(tmpDir, ".toby", "transcripts");
		fs.mkdirSync(dir, { recursive: true });
		fs.writeFileSync(path.join(dir, "a.md"), "content");

		const result = listTranscripts(tmpDir);
		expect(result).toHaveLength(1);
	});
});

describe("deleteTranscripts", () => {
	it("deletes all provided files and returns count", () => {
		const dir = createTranscriptsDir();
		const fileA = path.join(dir, "a.md");
		const fileB = path.join(dir, "b.md");
		fs.writeFileSync(fileA, "content");
		fs.writeFileSync(fileB, "content");

		const count = deleteTranscripts([fileA, fileB]);
		expect(count).toBe(2);
		expect(fs.existsSync(fileA)).toBe(false);
		expect(fs.existsSync(fileB)).toBe(false);
	});

	it("returns 0 for empty array", () => {
		expect(deleteTranscripts([])).toBe(0);
	});

	it("continues on individual file errors and returns partial count", () => {
		const dir = createTranscriptsDir();
		const fileA = path.join(dir, "a.md");
		fs.writeFileSync(fileA, "content");
		const nonexistent = path.join(dir, "nonexistent.md");

		const count = deleteTranscripts([fileA, nonexistent]);
		expect(count).toBe(1);
		expect(fs.existsSync(fileA)).toBe(false);
	});
});
