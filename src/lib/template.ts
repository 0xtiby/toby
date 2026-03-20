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
