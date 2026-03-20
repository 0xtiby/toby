import type { SpecFile } from "../types.js";

// ── Types ────────────────────────────────────────────────────────

export type SpecStatus = "pending" | "planned" | "building" | "done";

export interface Spec extends SpecFile {
	/** Numeric prefix order (null if no NN- prefix) */
	order: number | null;
	status: SpecStatus;
}

// ── Pure Functions ───────────────────────────────────────────────

/**
 * Extract the numeric order from a spec filename's NN- prefix.
 * Returns null if no valid numeric prefix exists.
 */
export function parseSpecOrder(filename: string): number | null {
	const match = /^(\d+)-/.exec(filename);
	if (!match) return null;
	return parseInt(match[1], 10);
}

/**
 * Sort specs: numbered ascending by order, unnumbered alphabetically after.
 * Duplicate numeric prefixes break ties alphabetically by name.
 */
export function sortSpecs<T extends { name: string; order: number | null }>(
	specs: T[],
): T[] {
	return [...specs].sort((a, b) => {
		// Both numbered: sort by order, then name
		if (a.order !== null && b.order !== null) {
			if (a.order !== b.order) return a.order - b.order;
			return a.name.localeCompare(b.name);
		}
		// Numbered before unnumbered
		if (a.order !== null) return -1;
		if (b.order !== null) return 1;
		// Both unnumbered: alphabetical
		return a.name.localeCompare(b.name);
	});
}

// ── Filesystem (stubs) ──────────────────────────────────────────

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
