/**
 * CLI metadata shared between cli.tsx and tests.
 * Extracted to avoid importing cli.tsx (which has side effects).
 */

/** Ordered list of all CLI command names */
export const COMMAND_NAMES = [
	"plan",
	"build",
	"init",
	"status",
	"config",
	"clean",
] as const;

/** All flag names accepted by meow (camelCase) */
export const MEOW_FLAG_NAMES = [
	"help",
	"spec",
	"specs",
	"all",
	"iterations",
	"verbose",
	"transcript",
	"cli",
	"planCli",
	"planModel",
	"buildCli",
	"buildModel",
	"specsDir",
	"session",
	"force",
] as const;
