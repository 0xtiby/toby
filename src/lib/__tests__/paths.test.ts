import { describe, it, expect, vi, beforeEach } from "vitest";
import path from "node:path";

// Mock fs to control file system operations
vi.mock("node:fs", () => ({
	default: {
		existsSync: vi.fn(() => false),
		mkdirSync: vi.fn(),
		writeFileSync: vi.fn(),
	},
	existsSync: vi.fn(() => false),
	mkdirSync: vi.fn(),
	writeFileSync: vi.fn(),
}));

import fs from "node:fs";
import {
	LOCAL_TOBY_DIR,
	CONFIG_FILE,
	getLocalDir,
	ensureLocalDir,
} from "../paths.js";

describe("paths", () => {
	beforeEach(() => {
		vi.mocked(fs.existsSync).mockReset();
		vi.mocked(fs.mkdirSync).mockReset();
		vi.mocked(fs.writeFileSync).mockReset();
		vi.mocked(fs.existsSync).mockReturnValue(false);
	});

	describe("constants", () => {
		it("LOCAL_TOBY_DIR is .toby", () => {
			expect(LOCAL_TOBY_DIR).toBe(".toby");
		});
	});

	describe("getLocalDir", () => {
		it("returns path ending in .toby under cwd when no arg", () => {
			const result = getLocalDir();
			expect(result).toBe(path.join(process.cwd(), ".toby"));
		});

		it("returns path ending in .toby under given cwd", () => {
			const result = getLocalDir("/tmp/proj");
			expect(result).toBe("/tmp/proj/.toby");
		});
	});

	describe("ensureLocalDir", () => {
		it("creates .toby/ with status.json when missing", () => {
			vi.mocked(fs.existsSync).mockReturnValue(false);

			const result = ensureLocalDir("/tmp/proj");

			expect(result).toBe("/tmp/proj/.toby");
			expect(fs.mkdirSync).toHaveBeenCalledWith("/tmp/proj/.toby", {
				recursive: true,
			});
			const written = vi.mocked(fs.writeFileSync).mock.calls[0];
			expect(written[0]).toBe("/tmp/proj/.toby/status.json");
			const parsed = JSON.parse(written[1] as string);
			expect(parsed).toEqual({ specs: {} });
		});

		it("does not overwrite status.json when it already exists", () => {
			vi.mocked(fs.existsSync).mockImplementation(
				(p) => p === "/tmp/proj/.toby/status.json",
			);

			ensureLocalDir("/tmp/proj");

			expect(fs.mkdirSync).toHaveBeenCalled();
			expect(fs.writeFileSync).not.toHaveBeenCalled();
		});

		it("returns correct path", () => {
			vi.mocked(fs.existsSync).mockReturnValue(false);
			expect(ensureLocalDir("/my/project")).toBe("/my/project/.toby");
		});
	});
});
