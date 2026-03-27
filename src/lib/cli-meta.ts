/**
 * CLI metadata shared between cli.tsx and tests.
 * Extracted to avoid importing cli.tsx (which has side effects).
 */

import { commandHelp } from "./help.js";

/** Derived from commandHelp — single source of truth */
export const COMMAND_NAMES = Object.keys(commandHelp);

/** Meow flags configuration — shared between cli.tsx and tests */
export const MEOW_FLAGS = {
	help: { type: "boolean", default: false },
	spec: { type: "string" },
	specs: { type: "string" },
	all: { type: "boolean", default: false },
	iterations: { type: "number" },
	verbose: { type: "boolean", default: false },
	transcript: { type: "boolean" },
	cli: { type: "string" },
	planCli: { type: "string" },
	planModel: { type: "string" },
	buildCli: { type: "string" },
	buildModel: { type: "string" },
	specsDir: { type: "string" },
	session: { type: "string" },
	force: { type: "boolean", default: false },
} as const;

/** Derived from MEOW_FLAGS — single source of truth */
export const MEOW_FLAG_NAMES = Object.keys(MEOW_FLAGS);

const AUTO_DEFAULTED_BOOLEANS = Object.entries(MEOW_FLAGS)
	.filter(([, def]) => def.type === "boolean" && !("default" in def))
	.map(([name]) => name);

/**
 * Meow v13 sets boolean flags to false even when the user doesn't pass them.
 * This breaks ?? fallthrough to config values. Normalize flags without an
 * explicit default back to undefined when the user didn't pass them.
 */
export function normalizeBooleanFlags<T extends Record<string, unknown>>(
	flags: T,
	rawArgs: string[],
): T {
	const result = { ...flags };
	const separatorIndex = rawArgs.indexOf("--");
	const flagArgs =
		separatorIndex === -1 ? rawArgs : rawArgs.slice(0, separatorIndex);

	for (const name of AUTO_DEFAULTED_BOOLEANS) {
		const kebab = name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
		const wasExplicit = flagArgs.some(
			(a) =>
				a === `--${kebab}` ||
				a === `--no-${kebab}` ||
				a.startsWith(`--${kebab}=`),
		);
		if (!wasExplicit) (result as Record<string, unknown>)[name] = undefined;
	}

	return result;
}
