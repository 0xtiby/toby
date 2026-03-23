import fs from "node:fs";
import path from "node:path";
import type { SpecFile, TobyConfig } from "../types.js";
import { StatusSchema } from "../types.js";
import { getLocalDir, STATUS_FILE } from "./paths.js";

// ── Types ────────────────────────────────────────────────────────

export type SpecStatus = "pending" | "planned" | "building" | "done";

export interface SpecOrder {
	num: number;
	suffix: string | null;
}

export interface Spec extends SpecFile {
	/** Parsed prefix order (null if no valid NN[a-z]?- prefix) */
	order: SpecOrder | null;
	status: SpecStatus;
}

// ── Pure Functions ───────────────────────────────────────────────

/**
 * Extract the order from a spec filename's NN[a-z]?- prefix.
 * Returns null if no valid prefix exists.
 */
export function parseSpecOrder(filename: string): SpecOrder | null {
	const match = /^(\d+)([a-z])?-/.exec(filename);
	if (!match) return null;
	return { num: parseInt(match[1], 10), suffix: match[2] ?? null };
}

/**
 * Sort specs: numbered ascending by order, unnumbered alphabetically after.
 * Duplicate numeric prefixes break ties alphabetically by name.
 */
export function sortSpecs<T extends { name: string; order: SpecOrder | null }>(
	specs: T[],
): T[] {
	return [...specs].sort((a, b) => {
		// Both numbered: sort by num, then suffix, then name
		if (a.order !== null && b.order !== null) {
			if (a.order.num !== b.order.num) return a.order.num - b.order.num;
			const sa = a.order.suffix ?? "";
			const sb = b.order.suffix ?? "";
			if (sa !== sb) return sa.localeCompare(sb);
			return a.name.localeCompare(b.name);
		}
		// Numbered before unnumbered
		if (a.order !== null) return -1;
		if (b.order !== null) return 1;
		// Both unnumbered: alphabetical
		return a.name.localeCompare(b.name);
	});
}

/**
 * Filter specs by their status.
 */
export function filterByStatus(specs: Spec[], status: SpecStatus): Spec[] {
	return specs.filter((s) => s.status === status);
}

/**
 * Find a spec by flexible name matching.
 * Matches against: exact name, filename with extension, or name with prefix stripped.
 * First match wins.
 */
export function findSpec(specs: Spec[], query: string): Spec | undefined {
	return specs.find((s) => {
		if (s.name === query) return true;
		if (`${s.name}.md` === query) return true;
		const withoutPrefix = s.name.replace(/^\d+[a-z]?-/, "");
		if (withoutPrefix === query) return true;
		// Match by numeric prefix alone (e.g., "09" matches "09-init-status-config")
		const prefixMatch = /^(\d+[a-z]?)-/.exec(s.name);
		if (prefixMatch && prefixMatch[1] === query) return true;
		return false;
	});
}

/**
 * Resolve a comma-separated query string into multiple specs.
 * Each query is trimmed, resolved via findSpec(), and deduplicated (first occurrence kept).
 * Results are sorted via sortSpecs(). Throws if any query fails to resolve.
 */
export function findSpecs(specs: Spec[], query: string): Spec[] {
	const queries = query.split(",").map((q) => q.trim()).filter((q) => q.length > 0);
	const seen = new Set<string>();
	const results: Spec[] = [];

	for (const q of queries) {
		const found = findSpec(specs, q);
		if (!found) {
			throw new Error(`Spec not found: "${q}"`);
		}
		if (!seen.has(found.name)) {
			seen.add(found.name);
			results.push(found);
		}
	}

	return sortSpecs(results);
}

// ── Filesystem ──────────────────────────────────────────────────

/**
 * Read spec status map from .toby/status.json.
 * Returns empty record if file is missing or malformed.
 */
function readStatusMap(cwd: string): Record<string, SpecStatus> {
	const statusPath = path.join(getLocalDir(cwd), STATUS_FILE);
	try {
		const raw = JSON.parse(fs.readFileSync(statusPath, "utf-8"));
		const parsed = StatusSchema.safeParse(raw);
		if (!parsed.success) return {};
		const result: Record<string, SpecStatus> = {};
		for (const [name, entry] of Object.entries(parsed.data.specs)) {
			result[name] = entry.status;
		}
		return result;
	} catch {
		return {};
	}
}

/**
 * Discover spec files in the configured specs directory, sorted by numeric prefix.
 * Reads .md files, applies excludeSpecs filter, looks up status from status.json.
 * Returns empty array if specs directory is missing.
 */
export function discoverSpecs(cwd: string, config: TobyConfig): Spec[] {
	const specsDir = path.resolve(cwd, config.specsDir);

	let entries: string[];
	try {
		entries = fs.readdirSync(specsDir);
	} catch {
		return [];
	}

	const mdFiles = entries.filter((f) => {
		if (!f.endsWith(".md")) return false;
		// Exclude by filename match
		return !config.excludeSpecs.includes(f);
	});

	if (mdFiles.length === 0) return [];

	const statusMap = readStatusMap(cwd);

	const specs: Spec[] = mdFiles.map((filename) => {
		const name = filename.replace(/\.md$/, "");
		return {
			name,
			path: path.join(specsDir, filename),
			order: parseSpecOrder(filename),
			status: statusMap[name] ?? "pending",
		};
	});

	return sortSpecs(specs);
}

/**
 * Load the content of a spec file.
 */
export function loadSpecContent(spec: SpecFile): SpecFile {
	const content = fs.readFileSync(spec.path, "utf-8");
	return { ...spec, content };
}
