import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import type {
	PromptTemplate,
	PromptFrontmatter,
	PromptName,
	TemplateVars,
	LoadPromptOptions,
	ComputeCliVarsOptions,
} from "../types.js";

/**
 * Strip frontmatter block (--- delimited) from raw prompt content.
 * Returns content without frontmatter. If no frontmatter found, returns original.
 */
function stripFrontmatter(raw: string): string {
	if (!raw.startsWith("---\n")) return raw;
	const closingIndex = raw.indexOf("\n---\n", 4);
	if (closingIndex === -1) return raw;
	return raw.slice(closingIndex + 5);
}
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
 * Load a prompt by name: resolve its path, read the file, strip frontmatter
 * if present, and substitute pre-merged vars.
 * Callers are responsible for calling resolveTemplateVars before loadPrompt.
 */
export function loadPrompt(
	name: PromptName,
	vars: TemplateVars,
	options: LoadPromptOptions = {},
): string {
	const { cwd } = options;
	const promptPath = resolvePromptPath(name, cwd);
	const raw = fs.readFileSync(promptPath, "utf-8");
	const content = stripFrontmatter(raw);
	return substitute(content, vars);
}

/**
 * Parse frontmatter directives from a prompt string.
 * Frontmatter must start with `---\n` and end with `---\n`.
 * Supports two directive formats:
 *   - List style:  `required_vars:\n  - A\n  - B`
 *   - Inline style: `required_vars: [A, B, C]`
 * Unrecognized keys are ignored.
 * Returns null frontmatter and original content if no valid frontmatter found.
 */
export function parseFrontmatter(raw: string): {
	frontmatter: PromptFrontmatter | null;
	content: string;
} {
	if (!raw.startsWith("---\n")) {
		return { frontmatter: null, content: raw };
	}

	const closingIndex = raw.indexOf("\n---\n", 4);
	if (closingIndex === -1) {
		return { frontmatter: null, content: raw };
	}

	const yamlBlock = raw.slice(4, closingIndex);
	const content = raw.slice(closingIndex + 5);

	const frontmatter: PromptFrontmatter = {};

	let currentKey: "required_vars" | "optional_vars" | null = null;
	for (const line of yamlBlock.split("\n")) {
		const trimmed = line.trim();
		if (trimmed === "" || trimmed.startsWith("#")) continue;

		const keyMatch = trimmed.match(/^(required_vars|optional_vars):\s*(.*)$/);
		if (keyMatch) {
			const key = keyMatch[1] as "required_vars" | "optional_vars";
			const rest = keyMatch[2].trim();

			// Inline array: required_vars: [A, B, C]
			const inlineMatch = rest.match(/^\[(.+)\]$/);
			if (inlineMatch) {
				frontmatter[key] = inlineMatch[1].split(",").map((s) => s.trim()).filter(Boolean);
				currentKey = null;
			} else {
				// Block list follows
				frontmatter[key] = [];
				currentKey = key;
			}
		} else if (currentKey && trimmed.startsWith("- ")) {
			const value = trimmed.slice(2).trim();
			if (value) {
				frontmatter[currentKey]!.push(value);
			}
		} else {
			currentKey = null;
		}
	}

	return { frontmatter, content };
}

/**
 * Validate that all required vars from frontmatter are present.
 * Throws when required variables are missing.
 */
export function validateRequiredVars(
	frontmatter: PromptFrontmatter | null,
	vars: TemplateVars,
	promptName: string,
): void {
	if (!frontmatter?.required_vars?.length) return;

	const missing: string[] = [];
	for (const varName of frontmatter.required_vars) {
		if (vars[varName] === undefined) {
			missing.push(varName);
		}
	}

	if (missing.length > 0) {
		throw new Error(
			`Prompt "${promptName}" is missing required variable(s): ${missing.join(", ")}`,
		);
	}
}

/**
 * Strip a single leading numeric prefix (digits followed by a dash) from a spec name.
 * e.g. '12-foo' → 'foo', '12-03-nested' → '03-nested', 'no-prefix' → 'no-prefix'
 */
export function computeSpecSlug(specName: string): string {
	return specName.replace(/^\d+-/, "");
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
