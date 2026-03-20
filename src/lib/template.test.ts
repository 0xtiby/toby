import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import {
	substitute,
	resolvePromptPath,
	getShippedPromptPath,
	loadPrompt,
} from "./template.js";

describe("substitute", () => {
	it("replaces a single variable", () => {
		expect(substitute("Hello {{NAME}}", { NAME: "world" } as any)).toBe(
			"Hello world",
		);
	});

	it("replaces multiple variables", () => {
		expect(substitute("{{A}} and {{B}}", { A: "1", B: "2" } as any)).toBe(
			"1 and 2",
		);
	});

	it("leaves unknown variables as-is", () => {
		expect(substitute("{{UNKNOWN}}", {})).toBe("{{UNKNOWN}}");
	});

	it("returns template unchanged when no variables present", () => {
		expect(substitute("no vars here", { FOO: "bar" } as any)).toBe(
			"no vars here",
		);
	});

	it("replaces TemplateVars fields correctly", () => {
		expect(
			substitute("{{SPEC_NAME}} iter {{ITERATION}}", {
				SPEC_NAME: "01-auth",
				ITERATION: "2",
			}),
		).toBe("01-auth iter 2");
	});

	it("handles mixed known and unknown variables", () => {
		expect(
			substitute("{{SPEC_NAME}} {{MISSING}}", { SPEC_NAME: "test" }),
		).toBe("test {{MISSING}}");
	});

	it("replaces multiple occurrences of the same variable", () => {
		expect(
			substitute("{{SPEC_NAME}} and {{SPEC_NAME}}", {
				SPEC_NAME: "auth",
			}),
		).toBe("auth and auth");
	});

	it("handles variable value containing {{ characters", () => {
		expect(
			substitute("Result: {{SPEC_NAME}}", {
				SPEC_NAME: "has {{braces}} inside",
			}),
		).toBe("Result: has {{braces}} inside");
	});

	it("returns empty string for empty template", () => {
		expect(substitute("", { SPEC_NAME: "test" })).toBe("");
	});

	it("replaces placeholder with empty string when value is empty", () => {
		expect(substitute("before {{SPEC_NAME}} after", { SPEC_NAME: "" })).toBe(
			"before  after",
		);
	});

	it("substitutes all TemplateVars fields correctly", () => {
		const vars: import("../types.js").TemplateVars = {
			SPEC_NAME: "01-auth",
			ITERATION: "3",
			BRANCH: "feat/auth",
			WORKTREE: ".worktrees/feat/auth",
			EPIC_NAME: "authentication",
			IS_LAST_SPEC: "true",
			PRD_PATH: ".toby/prd/01-auth.json",
			SPEC_CONTENT: "# Auth Spec",
		};
		const template =
			"{{SPEC_NAME}}|{{ITERATION}}|{{BRANCH}}|{{WORKTREE}}|{{EPIC_NAME}}|{{IS_LAST_SPEC}}|{{PRD_PATH}}|{{SPEC_CONTENT}}";
		expect(substitute(template, vars)).toBe(
			"01-auth|3|feat/auth|.worktrees/feat/auth|authentication|true|.toby/prd/01-auth.json|# Auth Spec",
		);
	});
});

describe("getShippedPromptPath", () => {
	it("returns correct path under prompts/ dir", () => {
		const result = getShippedPromptPath("PROMPT_PLAN");
		expect(result).toMatch(/prompts[/\\]PROMPT_PLAN\.md$/);
	});

	it("returns path for each PromptName", () => {
		for (const name of [
			"PROMPT_PLAN",
			"PROMPT_BUILD",
			"PROMPT_BUILD_ALL",
		] as const) {
			const result = getShippedPromptPath(name);
			expect(result).toContain(`${name}.md`);
		}
	});
});

describe("resolvePromptPath", () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "toby-test-"));
	});

	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	it("returns local path when exists in .toby/", () => {
		const localDir = path.join(tmpDir, ".toby");
		fs.mkdirSync(localDir, { recursive: true });
		fs.writeFileSync(path.join(localDir, "PROMPT_PLAN.md"), "local");

		const result = resolvePromptPath("PROMPT_PLAN", tmpDir);
		expect(result).toBe(path.join(localDir, "PROMPT_PLAN.md"));
	});

	it("returns shipped path when no overrides exist", () => {
		const result = resolvePromptPath("PROMPT_PLAN", tmpDir);
		expect(result).toMatch(/prompts[/\\]PROMPT_PLAN\.md$/);
	});

	it("prefers local over shipped", () => {
		const localDir = path.join(tmpDir, ".toby");
		fs.mkdirSync(localDir, { recursive: true });
		fs.writeFileSync(path.join(localDir, "PROMPT_BUILD.md"), "local override");

		const result = resolvePromptPath("PROMPT_BUILD", tmpDir);
		expect(result).toBe(path.join(localDir, "PROMPT_BUILD.md"));
	});

	it("throws when not found anywhere", () => {
		// Use a name that doesn't exist as shipped either — mock existsSync
		const origExistsSync = fs.existsSync;
		vi.spyOn(fs, "existsSync").mockReturnValue(false);

		expect(() => resolvePromptPath("PROMPT_PLAN", tmpDir)).toThrow(
			/Prompt "PROMPT_PLAN" not found/,
		);

		vi.mocked(fs.existsSync).mockRestore();
	});

	it("PROMPT_BUILD_ALL resolves correctly", () => {
		const result = resolvePromptPath("PROMPT_BUILD_ALL", tmpDir);
		expect(result).toMatch(/prompts[/\\]PROMPT_BUILD_ALL\.md$/);
	});

	it("error message lists all checked paths", () => {
		vi.spyOn(fs, "existsSync").mockReturnValue(false);

		try {
			resolvePromptPath("PROMPT_PLAN", tmpDir);
		} catch (e) {
			const msg = (e as Error).message;
			expect(msg).toContain(".toby");
			expect(msg).toContain("PROMPT_PLAN.md");
			expect(msg).toContain("prompts");
		}

		vi.mocked(fs.existsSync).mockRestore();
	});
});

describe("loadPrompt", () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "toby-test-"));
	});

	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	it("reads file and substitutes all vars", () => {
		const localDir = path.join(tmpDir, ".toby");
		fs.mkdirSync(localDir, { recursive: true });
		fs.writeFileSync(
			path.join(localDir, "PROMPT_PLAN.md"),
			"Plan for {{SPEC_NAME}} iteration {{ITERATION}}",
		);

		const result = loadPrompt(
			"PROMPT_PLAN",
			{ SPEC_NAME: "01-auth", ITERATION: "3" },
			tmpDir,
		);
		expect(result).toBe("Plan for 01-auth iteration 3");
	});

	it("substitutes SPEC_CONTENT when provided in vars", () => {
		const localDir = path.join(tmpDir, ".toby");
		fs.mkdirSync(localDir, { recursive: true });
		fs.writeFileSync(
			path.join(localDir, "PROMPT_BUILD.md"),
			"Build spec:\n{{SPEC_CONTENT}}",
		);

		const result = loadPrompt(
			"PROMPT_BUILD",
			{ SPEC_CONTENT: "# Auth\n\nImplement login flow" },
			tmpDir,
		);
		expect(result).toBe("Build spec:\n# Auth\n\nImplement login flow");
	});

	it("returns empty string for empty file", () => {
		const localDir = path.join(tmpDir, ".toby");
		fs.mkdirSync(localDir, { recursive: true });
		fs.writeFileSync(path.join(localDir, "PROMPT_PLAN.md"), "");

		const result = loadPrompt("PROMPT_PLAN", { SPEC_NAME: "test" }, tmpDir);
		expect(result).toBe("");
	});

	it("throws when prompt not found", () => {
		vi.spyOn(fs, "existsSync").mockReturnValue(false);

		expect(() => loadPrompt("PROMPT_PLAN", {}, tmpDir)).toThrow(
			/Prompt "PROMPT_PLAN" not found/,
		);

		vi.mocked(fs.existsSync).mockRestore();
	});
});
