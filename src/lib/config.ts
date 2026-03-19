import type { TobyConfig } from "../types.js";

/**
 * Resolve the merged configuration from global, local, and CLI overrides.
 */
export function resolveConfig(
	_projectRoot?: string,
): Promise<TobyConfig> {
	throw new Error("resolveConfig: not implemented");
}
