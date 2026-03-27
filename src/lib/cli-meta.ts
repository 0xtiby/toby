/**
 * CLI metadata shared between cli entry point and tests.
 * Extracted to avoid importing cli.ts (which has side effects).
 */

import { commandHelp } from "./help.js";

/** Derived from commandHelp — single source of truth */
export const COMMAND_NAMES = Object.keys(commandHelp);
