import fs from "node:fs";
import path from "node:path";
import { StatusSchema, SpecStatusEntrySchema } from "../types.js";
import type { StatusData, SpecStatusEntry, Iteration, Session, SessionState, CliName } from "../types.js";
import { getLocalDir, STATUS_FILE } from "./paths.js";

/**
 * Read and validate .toby/status.json.
 * Returns default { specs: {} } when file is missing.
 * Throws with file path in message when JSON is corrupted/invalid.
 */
export function readStatus(cwd?: string): StatusData {
	const filePath = path.join(getLocalDir(cwd), STATUS_FILE);

	if (!fs.existsSync(filePath)) {
		return { specs: {} };
	}

	let raw: string;
	try {
		raw = fs.readFileSync(filePath, "utf-8");
	} catch (err) {
		throw new Error(
			`Failed to read status file at ${filePath}: ${(err as Error).message}`,
		);
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch (err) {
		throw new Error(
			`Invalid JSON in status file at ${filePath}: ${(err as Error).message}`,
		);
	}

	const result = StatusSchema.safeParse(parsed);
	if (!result.success) {
		throw new Error(
			`Invalid status data at ${filePath}: ${result.error.message}`,
		);
	}

	return result.data;
}

/**
 * Write validated status data to .toby/status.json with pretty-print.
 * Creates .toby directory if it doesn't exist.
 */
export function writeStatus(status: StatusData, cwd?: string): void {
	const dir = getLocalDir(cwd);
	fs.mkdirSync(dir, { recursive: true });

	const filePath = path.join(dir, STATUS_FILE);
	const validated = StatusSchema.parse(status);
	fs.writeFileSync(filePath, JSON.stringify(validated, null, 2) + "\n");
}

/**
 * Get the status entry for a spec, or a default entry if it doesn't exist.
 */
export function getSpecStatus(
	status: StatusData,
	specName: string,
): SpecStatusEntry {
	const existing = status.specs[specName];
	if (existing) {
		return existing;
	}

	return SpecStatusEntrySchema.parse({
		status: "pending",
		plannedAt: null,
		iterations: [],
	});
}

/**
 * Append an iteration to a spec's iterations array.
 * Returns a new status object (immutable).
 */
export function addIteration(
	status: StatusData,
	specName: string,
	iteration: Iteration,
): StatusData {
	const entry = getSpecStatus(status, specName);

	return {
		...status,
		specs: {
			...status.specs,
			[specName]: {
				...entry,
				iterations: [...entry.iterations, iteration],
			},
		},
	};
}

/**
 * Create a new session object.
 */
export function createSession(name: string, cli: CliName, specs: string[]): Session {
	return {
		name,
		cli,
		specs,
		state: "active",
		startedAt: new Date().toISOString(),
	};
}

/**
 * Update the session state. Returns a new status object (immutable).
 */
export function updateSessionState(status: StatusData, state: SessionState): StatusData {
	if (!status.session) return status;
	return {
		...status,
		session: { ...status.session, state },
	};
}

/**
 * Clear the session from status. Returns a new status object (immutable).
 */
export function clearSession(status: StatusData): StatusData {
	return { specs: status.specs };
}

/**
 * Check if a resumable session exists (active or interrupted).
 */
export function hasResumableSession(status: StatusData): boolean {
	return status.session?.state === "active" || status.session?.state === "interrupted";
}

/**
 * Update the status field of a spec entry.
 * Returns a new status object (immutable).
 */
export function updateSpecStatus(
	status: StatusData,
	specName: string,
	newStatus: SpecStatusEntry["status"],
): StatusData {
	const entry = getSpecStatus(status, specName);

	return {
		...status,
		specs: {
			...status.specs,
			[specName]: {
				...entry,
				status: newStatus,
			},
		},
	};
}
