import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import {
	resolvePromptPath,
	getShippedPromptPath,
	loadPrompt,
	computeSpecSlug,
	computeCliVars,
	resolveConfigVars,
	resolveTemplateVars,
	generateSessionName,
} from "../template.js";

/**
 * Integration tests for prompt resolution and loading.
 * Uses real temp directories to test the 2-level resolution chain.
 */

describe("resolvePromptPath (integration)", () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "toby-tpl-"));
	});

	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
		vi.restoreAllMocks();
	});

	it("returns local override when present in .toby/", () => {
		const localDir = path.join(tmpDir, "project", ".toby");
		fs.mkdirSync(localDir, { recursive: true });
		fs.writeFileSync(path.join(localDir, "PROMPT_PLAN.md"), "local content");

		const result = resolvePromptPath(
			"PROMPT_PLAN",
			path.join(tmpDir, "project"),
		);
		expect(result).toBe(path.join(localDir, "PROMPT_PLAN.md"));
	});

	it("falls back to shipped prompt when no local override exists", () => {
		const projectDir = path.join(tmpDir, "project");
		fs.mkdirSync(projectDir, { recursive: true });

		const result = resolvePromptPath("PROMPT_PLAN", projectDir);
		expect(result).toMatch(/prompts[/\\]PROMPT_PLAN\.md$/);
	});

	it("throws with descriptive error listing all 2 paths checked", () => {
		vi.spyOn(fs, "existsSync").mockReturnValue(false);

		try {
			resolvePromptPath("PROMPT_PLAN", path.join(tmpDir, "project"));
			expect.fail("should have thrown");
		} catch (e) {
			const msg = (e as Error).message;
			expect(msg).toContain('Prompt "PROMPT_PLAN" not found');
			// Should list local path
			expect(msg).toContain(".toby");
			expect(msg).toContain("PROMPT_PLAN.md");
			// Should list shipped path
			expect(msg).toContain("prompts");
			// Should have 2 path entries (local, shipped)
			const pathLines = msg
				.split("\n")
				.filter((l) => l.trim().startsWith("- "));
			expect(pathLines).toHaveLength(2);
		}
	});

});

describe("getShippedPromptPath", () => {
	it("returns absolute path ending with prompts/<name>.md", () => {
		const result = getShippedPromptPath("PROMPT_PLAN");
		expect(path.isAbsolute(result)).toBe(true);
		expect(result).toMatch(/prompts[/\\]PROMPT_PLAN\.md$/);
	});

	it("returns correct path for each prompt name", () => {
		const names = ["PROMPT_PLAN", "PROMPT_BUILD"] as const;
		for (const name of names) {
			const result = getShippedPromptPath(name);
			expect(result).toContain(`${name}.md`);
			expect(path.isAbsolute(result)).toBe(true);
		}
	});
});

describe("loadPrompt (integration)", () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "toby-tpl-"));
	});

	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
		vi.restoreAllMocks();
	});

	it("reads file and substitutes all vars", () => {
		const localDir = path.join(tmpDir, ".toby");
		fs.mkdirSync(localDir, { recursive: true });
		fs.writeFileSync(
			path.join(localDir, "PROMPT_PLAN.md"),
			"Planning {{SPEC_NAME}} on branch {{BRANCH}} iteration {{ITERATION}}",
		);

		const result = loadPrompt(
			"PROMPT_PLAN",
			{ SPEC_NAME: "01-auth", BRANCH: "feat/auth", ITERATION: "2" },
			{ cwd: tmpDir },
		);
		expect(result).toBe("Planning 01-auth on branch feat/auth iteration 2");
	});

	it("returns empty string for empty file", () => {
		const localDir = path.join(tmpDir, ".toby");
		fs.mkdirSync(localDir, { recursive: true });
		fs.writeFileSync(path.join(localDir, "PROMPT_PLAN.md"), "");

		const result = loadPrompt(
			"PROMPT_PLAN",
			{ SPEC_NAME: "anything" },
			{ cwd: tmpDir },
		);
		expect(result).toBe("");
	});

	it("throws when prompt not found", () => {
		vi.spyOn(fs, "existsSync").mockReturnValue(false);

		expect(() => loadPrompt("PROMPT_PLAN", {}, { cwd: tmpDir })).toThrow(
			/Prompt "PROMPT_PLAN" not found/,
		);
	});
});

describe("computeSpecSlug", () => {
	it("strips single leading numeric prefix", () => {
		expect(computeSpecSlug("12-decouple-prd-from-code")).toBe("decouple-prd-from-code");
	});

	it("returns unchanged when no numeric prefix", () => {
		expect(computeSpecSlug("no-number-prefix")).toBe("no-number-prefix");
	});

	it("strips only the first numeric prefix", () => {
		expect(computeSpecSlug("12-03-nested")).toBe("03-nested");
	});

	it("strips alphanumeric prefix with letter suffix", () => {
		expect(computeSpecSlug("15a-template-variable-system")).toBe("template-variable-system");
	});

	it("strips alphanumeric prefix with any lowercase letter", () => {
		expect(computeSpecSlug("999z-foo")).toBe("foo");
	});

	it("does not strip uppercase letter suffix", () => {
		expect(computeSpecSlug("15A-foo")).toBe("15A-foo");
	});
});

describe("computeCliVars", () => {
	const defaultOptions = {
		specName: "12-auth",
		iteration: 3,
		specIndex: 1,
		specCount: 5,
		session: "my-session",
		specs: ["12-auth", "13-api"],
		specsDir: "specs",
	};

	it("returns all 8 CLI vars", () => {
		const vars = computeCliVars(defaultOptions);
		const keys = Object.keys(vars);
		expect(keys).toHaveLength(8);
		expect(keys).toEqual(
			expect.arrayContaining([
				"SPEC_NAME", "SPEC_SLUG", "ITERATION", "SPEC_INDEX",
				"SPEC_COUNT", "SESSION", "SPECS", "SPECS_DIR",
			]),
		);
	});

	it("all values are strings", () => {
		const vars = computeCliVars(defaultOptions);
		for (const value of Object.values(vars)) {
			expect(typeof value).toBe("string");
		}
	});

	it("computes SPEC_SLUG from specName", () => {
		const vars = computeCliVars(defaultOptions);
		expect(vars.SPEC_SLUG).toBe("auth");
	});

	it("converts numeric fields to strings", () => {
		const vars = computeCliVars(defaultOptions);
		expect(vars.ITERATION).toBe("3");
		expect(vars.SPEC_INDEX).toBe("1");
		expect(vars.SPEC_COUNT).toBe("5");
	});

	it("SPECS_DIR matches provided value", () => {
		const vars = computeCliVars({ ...defaultOptions, specsDir: "custom/specs" });
		expect(vars.SPECS_DIR).toBe("custom/specs");
	});

	it("joins specs array with comma separator", () => {
		const vars = computeCliVars(defaultOptions);
		expect(vars.SPECS).toBe("12-auth, 13-api");
	});
});

describe("resolveConfigVars", () => {
	it("substitutes CLI var references in config var values", () => {
		const result = resolveConfigVars(
			{ PRD_PATH: ".toby/{{SPEC_NAME}}.prd.json" },
			{ SPEC_NAME: "12-foo" },
		);
		expect(result).toEqual({ PRD_PATH: ".toby/12-foo.prd.json" });
	});

	it("substitutes multiple CLI var references in one value", () => {
		const result = resolveConfigVars(
			{ REPORT: "reports/{{SESSION}}/{{SPEC_NAME}}.md" },
			{ SESSION: "build-001", SPEC_NAME: "12-foo" },
		);
		expect(result).toEqual({ REPORT: "reports/build-001/12-foo.md" });
	});

	it("leaves {{NOPE}} as literal when CLI var does not exist", () => {
		const result = resolveConfigVars(
			{ PATH: "{{NOPE}}/file.txt" },
			{ SPEC_NAME: "12-foo" },
		);
		expect(result).toEqual({ PATH: "{{NOPE}}/file.txt" });
	});

	it("passes through static config vars unchanged", () => {
		const result = resolveConfigVars(
			{ STATIC: "no-refs-here" },
			{ SPEC_NAME: "12-foo" },
		);
		expect(result).toEqual({ STATIC: "no-refs-here" });
	});

	it("returns empty object for empty configVars", () => {
		const result = resolveConfigVars({}, { SPEC_NAME: "12-foo" });
		expect(result).toEqual({});
	});

	it("warns when verbose=true and config var shadows CLI var", () => {
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
		resolveConfigVars(
			{ SPEC_NAME: "overridden" },
			{ SPEC_NAME: "12-foo" },
			true,
		);
		expect(warnSpy).toHaveBeenCalledWith(
			'Config var "SPEC_NAME" is shadowed by CLI var',
		);
		warnSpy.mockRestore();
	});

	it("does not warn when verbose=false", () => {
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
		resolveConfigVars(
			{ SPEC_NAME: "overridden" },
			{ SPEC_NAME: "12-foo" },
		);
		expect(warnSpy).not.toHaveBeenCalled();
		warnSpy.mockRestore();
	});
});

describe("resolveTemplateVars", () => {
	it("CLI var wins over config var with same name", () => {
		const result = resolveTemplateVars(
			{ SPEC_NAME: "cli-value" },
			{ SPEC_NAME: "config-value" },
		);
		expect(result.SPEC_NAME).toBe("cli-value");
	});

	it("returns only CLI vars when configVars is empty", () => {
		const cliVars = { SPEC_NAME: "12-foo", ITERATION: "1" };
		const result = resolveTemplateVars(cliVars, {});
		expect(result).toEqual(cliVars);
	});

	it("merges resolved config vars with CLI vars", () => {
		const result = resolveTemplateVars(
			{ SPEC_NAME: "12-foo" },
			{ PRD_PATH: ".toby/{{SPEC_NAME}}.prd.json" },
		);
		expect(result).toEqual({
			SPEC_NAME: "12-foo",
			PRD_PATH: ".toby/12-foo.prd.json",
		});
	});

	it("passes verbose through to resolveConfigVars", () => {
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
		resolveTemplateVars(
			{ SPEC_NAME: "cli" },
			{ SPEC_NAME: "config" },
			true,
		);
		expect(warnSpy).toHaveBeenCalled();
		warnSpy.mockRestore();
	});
});

describe("generateSessionName", () => {
	it("returns adjective-noun-number format", () => {
		const name = generateSessionName();
		expect(name).toMatch(/^[a-z]+-[a-z]+-\d{2}$/);
	});

	it("number is in 10-99 range", () => {
		for (let i = 0; i < 50; i++) {
			const name = generateSessionName();
			const num = parseInt(name.split("-").pop()!, 10);
			expect(num).toBeGreaterThanOrEqual(10);
			expect(num).toBeLessThanOrEqual(99);
		}
	});

	it("produces different names across multiple calls", () => {
		const names = new Set(Array.from({ length: 20 }, () => generateSessionName()));
		expect(names.size).toBeGreaterThan(1);
	});
});
