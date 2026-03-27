import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import type {
	PromptName,
	TemplateVars,
	LoadPromptOptions,
	ComputeCliVarsOptions,
} from "../types.js";

import { getLocalDir } from "./paths.js";

/**
 * Returns the absolute path to a shipped prompt file inside the package's prompts/ directory.
 * Walks up from the current file's location until it finds a directory containing prompts/.
 * This works both in development (src/lib/) and after bundling (dist/).
 */
export function getShippedPromptPath(name: PromptName): string {
	const thisFile = fileURLToPath(import.meta.url);
	let dir = path.dirname(thisFile);
	// Walk up to find the package root (directory containing prompts/)
	while (dir !== path.dirname(dir)) {
		const candidate = path.join(dir, "prompts");
		if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) {
			return path.join(candidate, `${name}.md`);
		}
		dir = path.dirname(dir);
	}
	// Fallback: assume prompts/ is sibling to the directory containing this file
	const fallback = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "prompts");
	return path.join(fallback, `${name}.md`);
}

/**
 * Resolve a prompt file path through the 2-level chain:
 * 1. Local .toby/<name>.md (project override)
 * 2. Shipped prompts/<name>.md (package default)
 *
 * Returns the first existing path. Throws if not found at any level.
 */
export function resolvePromptPath(name: PromptName, cwd?: string): string {
	const filename = `${name}.md`;
	const candidates = [
		path.join(getLocalDir(cwd), filename),
		getShippedPromptPath(name),
	];

	for (const candidate of candidates) {
		if (fs.existsSync(candidate)) {
			return candidate;
		}
	}

	throw new Error(
		`Prompt "${name}" not found. Checked:\n${candidates.map((p) => `  - ${p}`).join("\n")}`,
	);
}

/**
 * Load a prompt by name: resolve its path, read the file, and substitute
 * pre-merged vars.
 * Callers are responsible for calling resolveTemplateVars before loadPrompt.
 */
export function loadPrompt(
	name: PromptName,
	vars: TemplateVars,
	options: LoadPromptOptions = {},
): string {
	const { cwd } = options;
	const promptPath = resolvePromptPath(name, cwd);
	const content = fs.readFileSync(promptPath, "utf-8");
	return substitute(content, vars);
}

/**
 * Strip a single leading alphanumeric prefix (digits, optional lowercase letter, dash) from a spec name.
 * e.g. '12-foo' → 'foo', '15a-bar' → 'bar', '12-03-nested' → '03-nested', 'no-prefix' → 'no-prefix'
 */
export function computeSpecSlug(specName: string): string {
	return specName.replace(/^\d+[a-z]?-/, "");
}

/**
 * Compute all CLI template variables from runtime state.
 * Returns a Record<string, string> with all 8 CLI vars.
 */
export function computeCliVars(options: ComputeCliVarsOptions): TemplateVars {
	return {
		SPEC_NAME: options.specName,
		SPEC_SLUG: computeSpecSlug(options.specName),
		ITERATION: String(options.iteration),
		SPEC_INDEX: String(options.specIndex),
		SPEC_COUNT: String(options.specCount),
		SESSION: options.session,
		SPECS: options.specs.join(", "),
		SPECS_DIR: options.specsDir,
	};
}

/**
 * Resolve config vars by substituting CLI var references in their values.
 * e.g. configVars = { PRD_PATH: ".toby/{{SPEC_NAME}}.prd.json" }, cliVars = { SPEC_NAME: "12-foo" }
 * → { PRD_PATH: ".toby/12-foo.prd.json" }
 */
export function resolveConfigVars(
	configVars: TemplateVars,
	cliVars: TemplateVars,
	verbose = false,
): TemplateVars {
	const resolved: TemplateVars = {};
	for (const [key, value] of Object.entries(configVars)) {
		if (verbose && key in cliVars) {
			console.warn(`Config var "${key}" is shadowed by CLI var`);
		}
		resolved[key] = substitute(value, cliVars);
	}
	return resolved;
}

/**
 * Merge CLI vars and config vars with two-step resolution:
 * 1. Resolve config vars (substitute CLI var references in their values)
 * 2. Merge: { ...resolvedConfigVars, ...cliVars } — CLI wins on conflict
 */
export function resolveTemplateVars(
	cliVars: TemplateVars,
	configVars: TemplateVars,
	verbose = false,
): TemplateVars {
	const resolved = resolveConfigVars(configVars, cliVars, verbose);
	return { ...resolved, ...cliVars };
}

const ADJECTIVES = [
	"bold", "calm", "cool", "dark", "fast", "free", "glad", "keen",
	"kind", "neat", "pure", "rare", "safe", "soft", "tall", "warm",
	"wild", "wise", "blue", "gold",
];

const NOUNS = [
	"bear", "crow", "deer", "dove", "fawn", "hawk", "lynx", "mare",
	"orca", "puma", "seal", "swan", "toad", "vole", "wolf", "wren",
	"colt", "hare", "moth", "ibis",
];

/**
 * Generate a random human-readable session name (e.g., "bold-tiger-42").
 */
export function generateSessionName(): string {
	const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
	const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)];
	const num = Math.floor(Math.random() * 90) + 10; // 10-99
	return `${adj}-${noun}-${num}`;
}

/**
 * Substitute template variables into prompt content.
 * Unknown {{VAR}} patterns are left as-is.
 */
export function substitute(
	template: string,
	vars: TemplateVars,
): string {
	return template.replace(/\{\{(\w+)\}\}/g, (match, key) => {
		const value = vars[key];
		return value !== undefined ? value : match;
	});
}
