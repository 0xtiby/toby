import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import {
	resolvePromptPath,
	getShippedPromptPath,
	loadPrompt,
	parseFrontmatter,
	validateRequiredVars,
} from "../template.js";

/**
 * Integration tests for prompt resolution and loading.
 * Uses real temp directories to test the 3-level resolution chain.
 */

describe("resolvePromptPath (integration)", () => {
	let tmpDir: string;
	let origHome: string;

	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "toby-tpl-"));
		origHome = process.env.HOME ?? os.homedir();
		// Point HOME to tmpDir so global ~/.toby resolves inside our temp dir
		process.env.HOME = tmpDir;
	});

	afterEach(() => {
		process.env.HOME = origHome;
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

	it("falls back to global ~/.toby when no local override", () => {
		const globalDir = path.join(tmpDir, ".toby");
		fs.mkdirSync(globalDir, { recursive: true });
		fs.writeFileSync(
			path.join(globalDir, "PROMPT_PLAN.md"),
			"global content",
		);

		const projectDir = path.join(tmpDir, "project");
		fs.mkdirSync(projectDir, { recursive: true });

		const result = resolvePromptPath("PROMPT_PLAN", projectDir);
		expect(result).toBe(path.join(globalDir, "PROMPT_PLAN.md"));
	});

	it("falls back to shipped prompt when no overrides exist", () => {
		const projectDir = path.join(tmpDir, "project");
		fs.mkdirSync(projectDir, { recursive: true });

		const result = resolvePromptPath("PROMPT_PLAN", projectDir);
		expect(result).toMatch(/prompts[/\\]PROMPT_PLAN\.md$/);
	});

	it("prefers local over global", () => {
		const projectDir = path.join(tmpDir, "project");
		const localDir = path.join(projectDir, ".toby");
		const globalDir = path.join(tmpDir, ".toby");

		fs.mkdirSync(localDir, { recursive: true });
		fs.mkdirSync(globalDir, { recursive: true });
		fs.writeFileSync(
			path.join(localDir, "PROMPT_BUILD.md"),
			"local override",
		);
		fs.writeFileSync(
			path.join(globalDir, "PROMPT_BUILD.md"),
			"global override",
		);

		const result = resolvePromptPath("PROMPT_BUILD", projectDir);
		expect(result).toBe(path.join(localDir, "PROMPT_BUILD.md"));
	});

	it("throws with descriptive error listing all 3 paths checked", () => {
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
			// Should have 3 path entries (local, global, shipped)
			const pathLines = msg
				.split("\n")
				.filter((l) => l.trim().startsWith("- "));
			expect(pathLines).toHaveLength(3);
		}
	});

	it("PROMPT_BUILD_ALL resolves to shipped path", () => {
		const projectDir = path.join(tmpDir, "project");
		fs.mkdirSync(projectDir, { recursive: true });

		const result = resolvePromptPath("PROMPT_BUILD_ALL", projectDir);
		expect(result).toMatch(/prompts[/\\]PROMPT_BUILD_ALL\.md$/);
	});
});

describe("getShippedPromptPath", () => {
	it("returns absolute path ending with prompts/<name>.md", () => {
		const result = getShippedPromptPath("PROMPT_PLAN");
		expect(path.isAbsolute(result)).toBe(true);
		expect(result).toMatch(/prompts[/\\]PROMPT_PLAN\.md$/);
	});

	it("returns correct path for each prompt name", () => {
		const names = ["PROMPT_PLAN", "PROMPT_BUILD", "PROMPT_BUILD_ALL"] as const;
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
			tmpDir,
		);
		expect(result).toBe("Planning 01-auth on branch feat/auth iteration 2");
	});

	it("substitutes SPEC_CONTENT into template", () => {
		const localDir = path.join(tmpDir, ".toby");
		fs.mkdirSync(localDir, { recursive: true });
		fs.writeFileSync(
			path.join(localDir, "PROMPT_BUILD.md"),
			"# Build\n\n{{SPEC_CONTENT}}\n\nBranch: {{BRANCH}}",
		);

		const specContent = "## Auth Spec\n\nImplement OAuth2 login flow";
		const result = loadPrompt(
			"PROMPT_BUILD",
			{ SPEC_CONTENT: specContent, BRANCH: "feat/auth" },
			tmpDir,
		);
		expect(result).toBe(
			`# Build\n\n${specContent}\n\nBranch: feat/auth`,
		);
	});

	it("loads PROMPT_BUILD_ALL and substitutes correctly", () => {
		const localDir = path.join(tmpDir, ".toby");
		fs.mkdirSync(localDir, { recursive: true });
		fs.writeFileSync(
			path.join(localDir, "PROMPT_BUILD_ALL.md"),
			"Build all: {{EPIC_NAME}} last={{IS_LAST_SPEC}}",
		);

		const result = loadPrompt(
			"PROMPT_BUILD_ALL",
			{ EPIC_NAME: "authentication", IS_LAST_SPEC: "false" },
			tmpDir,
		);
		expect(result).toBe("Build all: authentication last=false");
	});

	it("returns empty string for empty file", () => {
		const localDir = path.join(tmpDir, ".toby");
		fs.mkdirSync(localDir, { recursive: true });
		fs.writeFileSync(path.join(localDir, "PROMPT_PLAN.md"), "");

		const result = loadPrompt(
			"PROMPT_PLAN",
			{ SPEC_NAME: "anything" },
			tmpDir,
		);
		expect(result).toBe("");
	});

	it("throws when prompt not found", () => {
		vi.spyOn(fs, "existsSync").mockReturnValue(false);

		expect(() => loadPrompt("PROMPT_PLAN", {}, tmpDir)).toThrow(
			/Prompt "PROMPT_PLAN" not found/,
		);
	});
});

describe("parseFrontmatter", () => {
	it("extracts required and optional vars from valid frontmatter", () => {
		const raw = `---\nrequired_vars:\n  - API_KEY\n  - DB_URL\noptional_vars:\n  - VERBOSE\n---\nHello {{API_KEY}}`;
		const { frontmatter, content } = parseFrontmatter(raw);
		expect(frontmatter).toEqual({
			required_vars: ["API_KEY", "DB_URL"],
			optional_vars: ["VERBOSE"],
		});
		expect(content).toBe("Hello {{API_KEY}}");
	});

	it("returns null frontmatter and original content when no frontmatter", () => {
		const raw = "Just a plain prompt with {{VAR}}";
		const { frontmatter, content } = parseFrontmatter(raw);
		expect(frontmatter).toBeNull();
		expect(content).toBe(raw);
	});

	it("returns null frontmatter when closing --- is missing (malformed)", () => {
		const raw = "---\nrequired_vars:\n  - FOO\nno closing marker here";
		const { frontmatter, content } = parseFrontmatter(raw);
		expect(frontmatter).toBeNull();
		expect(content).toBe(raw);
	});

	it("handles frontmatter with only required_vars", () => {
		const raw = "---\nrequired_vars:\n  - ONLY_ONE\n---\ncontent";
		const { frontmatter, content } = parseFrontmatter(raw);
		expect(frontmatter).toEqual({ required_vars: ["ONLY_ONE"] });
		expect(content).toBe("content");
	});

	it("handles frontmatter with only optional_vars", () => {
		const raw = "---\noptional_vars:\n  - DEBUG\n---\ncontent";
		const { frontmatter, content } = parseFrontmatter(raw);
		expect(frontmatter).toEqual({ optional_vars: ["DEBUG"] });
		expect(content).toBe("content");
	});

	it("handles empty frontmatter block", () => {
		const raw = "---\n\n---\ncontent after";
		const { frontmatter, content } = parseFrontmatter(raw);
		expect(frontmatter).toEqual({});
		expect(content).toBe("content after");
	});
});

describe("validateRequiredVars", () => {
	it("returns empty array when all required vars are present", () => {
		const frontmatter = { required_vars: ["A", "B"] };
		const vars = { A: "1", B: "2" };
		expect(validateRequiredVars(frontmatter, vars, "test")).toEqual([]);
	});

	it("returns missing var names and warns for each", () => {
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
		const frontmatter = { required_vars: ["A", "B", "C"] };
		const vars = { A: "1" };
		const missing = validateRequiredVars(frontmatter, vars, "my-prompt");
		expect(missing).toEqual(["B", "C"]);
		expect(warnSpy).toHaveBeenCalledTimes(2);
		expect(warnSpy).toHaveBeenCalledWith('Warning: prompt "my-prompt" requires variable B');
		expect(warnSpy).toHaveBeenCalledWith('Warning: prompt "my-prompt" requires variable C');
		warnSpy.mockRestore();
	});

	it("returns empty array when frontmatter is null (backward compat)", () => {
		expect(validateRequiredVars(null, {}, "test")).toEqual([]);
	});

	it("returns empty array when frontmatter has no required_vars", () => {
		expect(validateRequiredVars({ optional_vars: ["X"] }, {}, "test")).toEqual([]);
	});
});
