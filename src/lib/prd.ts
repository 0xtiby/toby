import fs from "node:fs";
import path from "node:path";
import { PrdSchema, TaskStatusSchema } from "../types.js";
import type { PRDData, TaskStatus } from "../types.js";
import { getLocalDir, PRD_DIR } from "./paths.js";

/** Get the file path for a spec's prd.json */
export function getPrdPath(specName: string, cwd?: string): string {
	return path.join(getLocalDir(cwd), PRD_DIR, `${specName}.json`);
}

/** Check if a prd.json exists for a spec */
export function hasPrd(specName: string, cwd?: string): boolean {
	return fs.existsSync(getPrdPath(specName, cwd));
}

/** Read and validate a prd.json file for a spec. Returns null if missing. */
export function readPrd(specName: string, cwd?: string): PRDData | null {
	const filePath = getPrdPath(specName, cwd);

	if (!fs.existsSync(filePath)) {
		return null;
	}

	const raw = fs.readFileSync(filePath, "utf-8");
	try {
		return PrdSchema.parse(JSON.parse(raw));
	} catch (err) {
		throw new Error(
			`Invalid PRD at ${filePath}: ${(err as Error).message}`,
		);
	}
}

/** Get task counts by status */
export function getTaskSummary(prd: PRDData): Record<TaskStatus, number> {
	const summary: Record<TaskStatus, number> = {
		pending: 0,
		in_progress: 0,
		done: 0,
		blocked: 0,
	};

	for (const task of prd.tasks) {
		summary[task.status]++;
	}

	return summary;
}
