import fs from "node:fs";
import type { SpecStatus } from "./specs.js";
import { discoverSpecs } from "./specs.js";
import { loadConfig } from "./config.js";
import { readStatus } from "./status.js";
import { getLocalDir } from "./paths.js";

export interface ProjectStats {
	totalSpecs: number;
	pending: number;
	planned: number;
	building: number;
	done: number;
	totalIterations: number;
}

/**
 * Compute aggregate project statistics from specs and status.
 * Returns null if the project is not initialized (.toby/ doesn't exist).
 */
export function computeProjectStats(cwd?: string): ProjectStats | null {
	if (!fs.existsSync(getLocalDir(cwd))) {
		return null;
	}

	let statusData;
	try {
		statusData = readStatus(cwd);
	} catch {
		return null;
	}

	const config = loadConfig(cwd);
	const resolvedCwd = cwd ?? process.cwd();
	const specs = discoverSpecs(resolvedCwd, config);

	const counts: Record<SpecStatus, number> = {
		pending: 0,
		planned: 0,
		building: 0,
		done: 0,
	};

	for (const spec of specs) {
		counts[spec.status]++;
	}

	let totalIterations = 0;
	for (const entry of Object.values(statusData.specs)) {
		totalIterations += entry.iterations.length;
	}

	return {
		totalSpecs: specs.length,
		pending: counts.pending,
		planned: counts.planned,
		building: counts.building,
		done: counts.done,
		totalIterations,
	};
}
