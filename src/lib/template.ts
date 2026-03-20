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
 */
export function getShippedPromptPath(name: PromptName): string {
	const thisFile = fileURLToPath(import.meta.url);
	const promptsDir = path.resolve(path.dirname(thisFile), "..", "..", "prompts");
	return path.join(promptsDir, `${name}.md`);
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
 * Resolve a prompt template by name, searching local then global then bundled.
 */
export function resolvePrompt(
	_name: PromptName,
	_projectRoot?: string,
): Promise<PromptTemplate> {
	throw new Error("resolvePrompt: not implemented");
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
