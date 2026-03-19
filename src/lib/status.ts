import type { StatusData, Iteration } from "../types.js";

/**
 * Read the status file for the project.
 */
export function readStatus(_projectRoot: string): Promise<StatusData> {
	throw new Error("readStatus: not implemented");
}

/**
 * Write the status file.
 */
export function writeStatus(
	_projectRoot: string,
	_status: StatusData,
): Promise<void> {
	throw new Error("writeStatus: not implemented");
}

/**
 * Record a completed iteration in the status file.
 */
export function recordIteration(
	_projectRoot: string,
	_specName: string,
	_iteration: Iteration,
): Promise<void> {
	throw new Error("recordIteration: not implemented");
}
