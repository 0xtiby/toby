import type { PRDData } from "../types.js";

/**
 * Read and validate a PRD JSON file.
 */
export function readPrd(_path: string): Promise<PRDData> {
	throw new Error("readPrd: not implemented");
}

/**
 * Write a PRD to disk.
 */
export function writePrd(
	_path: string,
	_prd: PRDData,
): Promise<void> {
	throw new Error("writePrd: not implemented");
}
