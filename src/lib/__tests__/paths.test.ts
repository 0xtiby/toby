import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import path from "node:path";
import os from "node:os";

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
	GLOBAL_TOBY_DIR,
	LOCAL_TOBY_DIR,
	CONFIG_FILE,
	getGlobalDir,
	getLocalDir,
	ensureGlobalDir,
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
		it("GLOBAL_TOBY_DIR is .toby", () => {
			expect(GLOBAL_TOBY_DIR).toBe(".toby");
		});

		it("LOCAL_TOBY_DIR is .toby", () => {
			expect(LOCAL_TOBY_DIR).toBe(".toby");
		});
	});

	describe("getGlobalDir", () => {
		it("returns path ending in .toby under home dir", () => {
			const result = getGlobalDir();
			expect(result).toBe(path.join(os.homedir(), ".toby"));
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

	describe("ensureGlobalDir", () => {
		it("creates ~/.toby/ and writes default config.json when missing", () => {
			vi.mocked(fs.existsSync).mockReturnValue(false);

			ensureGlobalDir();

			const globalDir = path.join(os.homedir(), ".toby");
			expect(fs.mkdirSync).toHaveBeenCalledWith(globalDir, {
				recursive: true,
			});
			expect(fs.writeFileSync).toHaveBeenCalledWith(
				path.join(globalDir, CONFIG_FILE),
				expect.stringContaining('"plan"'),
			);

			// Verify the written content is valid JSON with schema defaults
			const writtenContent = vi.mocked(fs.writeFileSync).mock
				.calls[0][1] as string;
			const parsed = JSON.parse(writtenContent);
			expect(parsed.plan).toBeDefined();
			expect(parsed.build).toBeDefined();
			expect(parsed.specsDir).toBe("specs");
		});

		it("does nothing when config.json already exists", () => {
			const configPath = path.join(os.homedir(), ".toby", CONFIG_FILE);
			vi.mocked(fs.existsSync).mockImplementation((p) => p === configPath);

			ensureGlobalDir();

			expect(fs.mkdirSync).toHaveBeenCalled();
			expect(fs.writeFileSync).not.toHaveBeenCalled();
		});

		it("warns and continues on permission errors", () => {
			const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
			vi.mocked(fs.mkdirSync).mockImplementation(() => {
				throw new Error("EACCES: permission denied");
			});

			ensureGlobalDir();

			expect(warnSpy).toHaveBeenCalledWith(
				expect.stringContaining("could not initialize"),
			);
			expect(fs.writeFileSync).not.toHaveBeenCalled();
			warnSpy.mockRestore();
		});
	});
});
