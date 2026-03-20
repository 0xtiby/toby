import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import type {
	PromptTemplate,
	PromptName,
	TemplateVars,
} from "../types.js";
import { getLocalDir, getGlobalDir } from "./paths.js";

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
 * Resolve a prompt file path through the 3-level chain:
 * 1. Local .toby/<name>.md (project override)
 * 2. Global ~/.toby/<name>.md (user override)
 * 3. Shipped prompts/<name>.md (package default)
 *
 * Returns the first existing path. Throws if not found at any level.
 */
export function resolvePromptPath(name: PromptName, cwd?: string): string {
	const filename = `${name}.md`;
	const candidates = [
		path.join(getLocalDir(cwd), filename),
		path.join(getGlobalDir(), filename),
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
 * Load a prompt by name: resolve its path, read the file, and substitute variables.
 * Returns the final prompt string with all provided variables replaced.
 */
export function loadPrompt(
	name: PromptName,
	vars: Partial<TemplateVars>,
	cwd?: string,
): string {
	const promptPath = resolvePromptPath(name, cwd);
	const content = fs.readFileSync(promptPath, "utf-8");
	return substitute(content, vars);
}

/**
 * Substitute template variables into prompt content.
 * Unknown {{VAR}} patterns are left as-is.
 */
export function substitute(
	template: string,
	vars: Partial<TemplateVars>,
): string {
	return template.replace(/\{\{(\w+)\}\}/g, (match, key) => {
		const value = vars[key as keyof TemplateVars];
		return value !== undefined ? value : match;
	});
}
