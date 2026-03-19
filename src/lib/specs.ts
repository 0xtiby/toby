import type { SpecFile } from "../types.js";

/**
 * Discover spec files in the given directory, sorted by numeric prefix.
 */
export function discoverSpecs(_specsDir: string): Promise<SpecFile[]> {
	throw new Error("discoverSpecs: not implemented");
}

/**
 * Load the content of a spec file.
 */
export function loadSpecContent(_spec: SpecFile): Promise<SpecFile> {
	throw new Error("loadSpecContent: not implemented");
}
