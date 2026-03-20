import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import path from "node:path";
import os from "node:os";

// Mock fs.existsSync to control prompt file resolution
vi.mock("node:fs", () => ({
	default: { existsSync: vi.fn(() => false) },
	existsSync: vi.fn(() => false),
}));

import fs from "node:fs";
import {
	GLOBAL_TOBY_DIR,
	LOCAL_TOBY_DIR,
	getGlobalDir,
	getLocalDir,
	getPromptPath,
} from "../paths.js";

describe("paths", () => {
	beforeEach(() => {
		vi.mocked(fs.existsSync).mockReset();
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

	describe("getPromptPath", () => {
		it("returns local override when it exists", () => {
			const cwd = "/tmp/proj";
			const localPath = path.join(cwd, ".toby", "PROMPT_PLAN.md");

			vi.mocked(fs.existsSync).mockImplementation(
				(p) => p === localPath,
			);

			expect(getPromptPath("PROMPT_PLAN.md", cwd)).toBe(localPath);
		});

		it("falls back to global when no local", () => {
			const cwd = "/tmp/proj";
			const globalPath = path.join(os.homedir(), ".toby", "PROMPT_PLAN.md");

			vi.mocked(fs.existsSync).mockImplementation(
				(p) => p === globalPath,
			);

			expect(getPromptPath("PROMPT_PLAN.md", cwd)).toBe(globalPath);
		});

		it("falls back to shipped when no overrides", () => {
			const cwd = "/tmp/proj";

			vi.mocked(fs.existsSync).mockImplementation((p) =>
				String(p).includes("prompts/PROMPT_PLAN.md") &&
				!String(p).includes(".toby"),
			);

			const result = getPromptPath("PROMPT_PLAN.md", cwd);
			expect(result).toBeDefined();
			expect(result).toContain("prompts/PROMPT_PLAN.md");
			expect(result).not.toContain(".toby");
		});

		it("returns undefined when prompt doesn't exist anywhere", () => {
			expect(getPromptPath("NONEXISTENT.md", "/tmp/proj")).toBeUndefined();
		});

		it("prefers local over global", () => {
			const cwd = "/tmp/proj";
			const localPath = path.join(cwd, ".toby", "PROMPT_BUILD.md");
			const globalPath = path.join(os.homedir(), ".toby", "PROMPT_BUILD.md");

			vi.mocked(fs.existsSync).mockImplementation(
				(p) => p === localPath || p === globalPath,
			);

			expect(getPromptPath("PROMPT_BUILD.md", cwd)).toBe(localPath);
		});
	});
});
