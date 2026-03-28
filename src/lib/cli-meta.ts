/**
 * CLI metadata shared between cli entry point and tests.
 * Extracted to avoid importing cli.ts (which has side effects).
 */

export const COMMAND_NAMES = [
	"plan",
	"build",
	"resume",
	"init",
	"status",
	"config",
	"clean",
];
