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
