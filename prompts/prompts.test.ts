import { describe, it, expect } from "vitest";
import { readFileSync, accessSync } from "node:fs";
import { join } from "node:path";

const PROMPTS_DIR = join(import.meta.dirname, ".");

const PROMPT_FILES = ["PROMPT_PLAN.md", "PROMPT_BUILD.md", "PROMPT_BUILD_ALL.md"] as const;

function readPrompt(name: string): string {
	return readFileSync(join(PROMPTS_DIR, name), "utf-8");
}

function extractVars(content: string): string[] {
	const matches = content.matchAll(/\{\{(\w+)\}\}/g);
	return [...new Set([...matches].map((m) => m[1]))];
}

describe("prompt files", () => {
	it.each(PROMPT_FILES)("%s exists and is readable", (file) => {
		expect(() => accessSync(join(PROMPTS_DIR, file))).not.toThrow();
	});

	it.each(PROMPT_FILES)("%s is non-empty markdown", (file) => {
		const content = readPrompt(file);
		expect(content.length).toBeGreaterThan(0);
		expect(content).toContain("#");
	});

	it.each(PROMPT_FILES)("%s contains :::TOBY_DONE::: sentinel", (file) => {
		const content = readPrompt(file);
		expect(content).toContain(":::TOBY_DONE:::");
	});

	it.each(PROMPT_FILES)("%s uses {{VAR_NAME}} syntax", (file) => {
		const content = readPrompt(file);
		// No single-brace vars like {VAR}
		const singleBrace = content.match(/(?<!\{)\{([A-Z_]+)\}(?!\})/g);
		expect(singleBrace).toBeNull();
	});
});

describe("PROMPT_PLAN.md variables", () => {
	const vars = extractVars(readPrompt("PROMPT_PLAN.md"));

	it.each(["SPEC_NAME", "ITERATION", "PRD_PATH", "SPECS_DIR"])(
		"contains %s",
		(v) => {
			expect(vars).toContain(v);
		},
	);
});

describe("PROMPT_BUILD.md variables", () => {
	const vars = extractVars(readPrompt("PROMPT_BUILD.md"));

	it.each(["SPEC_NAME", "ITERATION", "SPECS_DIR", "SPEC_INDEX", "SPEC_COUNT", "SESSION", "SPECS"])(
		"contains %s",
		(v) => {
			expect(vars).toContain(v);
		},
	);
});

describe("PROMPT_BUILD_ALL.md variables", () => {
	const vars = extractVars(readPrompt("PROMPT_BUILD_ALL.md"));

	it("contains IS_LAST_SPEC", () => {
		expect(vars).toContain("IS_LAST_SPEC");
	});

	it("contains EPIC_NAME", () => {
		expect(vars).toContain("EPIC_NAME");
	});
});
