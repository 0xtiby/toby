import type {
	PromptTemplate,
	PromptName,
	TemplateVars,
} from "../types.js";

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
 */
export function substitute(
	_template: string,
	_vars: TemplateVars,
): string {
	throw new Error("substitute: not implemented");
}
