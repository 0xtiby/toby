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
	computeSpecSlug,
	computeCliVars,
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
			{ cwd: tmpDir },
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
			{ cwd: tmpDir },
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
			{ cwd: tmpDir },
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

	it("parses inline array format", () => {
		const raw = "---\nrequired_vars: [A, B, C]\noptional_vars: [DEBUG]\n---\ncontent";
		const { frontmatter, content } = parseFrontmatter(raw);
		expect(frontmatter).toEqual({
			required_vars: ["A", "B", "C"],
			optional_vars: ["DEBUG"],
		});
		expect(content).toBe("content");
	});

	it("ignores comment lines in frontmatter", () => {
		const raw = "---\n# This is a comment\nrequired_vars:\n  - FOO\n---\ncontent";
		const { frontmatter, content } = parseFrontmatter(raw);
		expect(frontmatter).toEqual({ required_vars: ["FOO"] });
		expect(content).toBe("content");
	});
});

describe("validateRequiredVars", () => {
	it("does not throw when all required vars are present", () => {
		const frontmatter = { required_vars: ["A", "B"] };
		const vars = { A: "1", B: "2" };
		expect(() => validateRequiredVars(frontmatter, vars, "test")).not.toThrow();
	});

	it("throws with missing var names listed", () => {
		const frontmatter = { required_vars: ["A", "B", "C"] };
		const vars = { A: "1" };
		expect(() => validateRequiredVars(frontmatter, vars, "my-prompt")).toThrow(
			'Prompt "my-prompt" is missing required variable(s): B, C',
		);
	});

	it("does not throw when frontmatter is null (backward compat)", () => {
		expect(() => validateRequiredVars(null, {}, "test")).not.toThrow();
	});

	it("does not throw when frontmatter has no required_vars", () => {
		expect(() => validateRequiredVars({ optional_vars: ["X"] }, {}, "test")).not.toThrow();
	});

	it("does not throw when required_vars is empty array", () => {
		expect(() => validateRequiredVars({ required_vars: [] }, {}, "test")).not.toThrow();
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
