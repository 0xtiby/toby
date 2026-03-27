import fs from "node:fs";
import path from "node:path";
import * as clack from "@clack/prompts";
import chalk from "chalk";
import { detectAll, listModels } from "@0xtiby/spawner";
import { loadConfig, writeConfig } from "../lib/config.js";
import { getLocalDir, CONFIG_FILE } from "../lib/paths.js";
import { ConfigSchema, CLI_NAMES } from "../types.js";
import type { TobyConfig, CliName } from "../types.js";
import { isTTY } from "../ui/tty.js";

/** All valid dot-notation keys and their expected types */
export const VALID_KEYS: Record<string, "string" | "number" | "boolean" | "string[]"> = {
	"plan.cli": "string",
	"plan.model": "string",
	"plan.iterations": "number",
	"build.cli": "string",
	"build.model": "string",
	"build.iterations": "number",
	specsDir: "string",
	verbose: "boolean",
	transcript: "boolean",
};

export function getNestedValue(obj: Record<string, unknown>, key: string): unknown {
	const parts = key.split(".");
	let current: unknown = obj;
	for (const part of parts) {
		if (current === null || current === undefined || typeof current !== "object") {
			return undefined;
		}
		current = (current as Record<string, unknown>)[part];
	}
	return current;
}

export function setNestedValue(obj: Record<string, unknown>, key: string, value: unknown): void {
	const parts = key.split(".");
	let current = obj;
	for (let i = 0; i < parts.length - 1; i++) {
		const part = parts[i];
		if (!(part in current) || typeof current[part] !== "object" || current[part] === null) {
			current[part] = {};
		}
		current = current[part] as Record<string, unknown>;
	}
	current[parts[parts.length - 1]] = value;
}

export function parseValue(raw: string, type: "string" | "number" | "boolean" | "string[]"): unknown {
	switch (type) {
		case "number": {
			const n = Number(raw);
			if (Number.isNaN(n)) throw new Error(`Expected a number, got "${raw}"`);
			return n;
		}
		case "boolean": {
			if (raw === "true") return true;
			if (raw === "false") return false;
			throw new Error(`Expected true or false, got "${raw}"`);
		}
		default:
			return raw;
	}
}

/** Read existing config, merge mutations, write once. Throws on write errors. */
export function readMergeWriteConfig(mutations: { key: string; value: unknown }[]): void {
	const cwd = process.cwd();
	const configPath = path.join(getLocalDir(cwd), CONFIG_FILE);
	let existing: Record<string, unknown> = {};
	try {
		const content = fs.readFileSync(configPath, "utf-8");
		existing = JSON.parse(content);
	} catch {
		// File doesn't exist yet, start fresh
	}

	for (const { key, value } of mutations) {
		setNestedValue(existing, key, value);
	}

	writeConfig(existing as Partial<TobyConfig>, configPath);
}

/** Print a single config value to stdout. Sets exitCode=1 on error. */
export function configGet(key: string): void {
	if (!(key in VALID_KEYS)) {
		console.error(`Unknown config key: ${key}\nValid keys: ${Object.keys(VALID_KEYS).join(", ")}`);
		process.exitCode = 1;
		return;
	}

	const cwd = process.cwd();
	const localDir = getLocalDir(cwd);
	if (!fs.existsSync(localDir)) {
		console.error("No config found\nRun toby init to set up your project.");
		process.exitCode = 1;
		return;
	}

	const config = loadConfig();
	const value = getNestedValue(config as unknown as Record<string, unknown>, key);
	console.log(String(value));
}

/** Print all config values as key = value lines. */
export function configListAll(): void {
	const config = loadConfig();
	for (const key of Object.keys(VALID_KEYS)) {
		const value = getNestedValue(config as unknown as Record<string, unknown>, key);
		console.log(`${key} = ${String(value)}`);
	}
}

/** Set a single config value. Validates type and schema. Sets exitCode=1 on error. */
export function configSet(key: string, rawValue: string): void {
	if (!(key in VALID_KEYS)) {
		console.error(`Unknown config key: ${key}\nValid keys: ${Object.keys(VALID_KEYS).join(", ")}`);
		process.exitCode = 1;
		return;
	}

	const type = VALID_KEYS[key];
	let parsed: unknown;
	try {
		parsed = parseValue(rawValue, type);
	} catch (err) {
		console.error(`Invalid value for ${key}: ${(err as Error).message}`);
		process.exitCode = 1;
		return;
	}

	// Validate against schema (catches invalid CLI names, etc.)
	const partial: Record<string, unknown> = {};
	setNestedValue(partial, key, parsed);
	try {
		ConfigSchema.parse({ ...partial });
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		console.error(`Validation error for ${key}: ${msg}`);
		process.exitCode = 1;
		return;
	}

	try {
		readMergeWriteConfig([{ key, value: parsed }]);
	} catch (err) {
		const code = (err as NodeJS.ErrnoException).code;
		const msg = code === "EACCES"
			? `Permission denied writing to ${path.join(getLocalDir(process.cwd()), CONFIG_FILE)}`
			: `Failed to write config: ${(err as Error).message}`;
		console.error(msg);
		process.exitCode = 1;
		return;
	}

	console.log(`Set ${key} = ${String(parsed)}`);
}

/** Set multiple config values atomically from key=value pairs. Sets exitCode=1 on error. */
export function configSetBatch(pairs: string[]): void {
	const parsed: { key: string; value: unknown }[] = [];
	const errors: string[] = [];

	for (const pair of pairs) {
		const eqIndex = pair.indexOf("=");
		if (eqIndex === -1) {
			errors.push(`Invalid format: "${pair}" (expected key=value)`);
			continue;
		}

		const key = pair.slice(0, eqIndex);
		const raw = pair.slice(eqIndex + 1);

		if (!(key in VALID_KEYS)) {
			errors.push(`Unknown config key: ${key}`);
			continue;
		}

		try {
			const value = parseValue(raw, VALID_KEYS[key]);
			parsed.push({ key, value });
		} catch (err) {
			errors.push(`Invalid value for ${key}: ${(err as Error).message}`);
		}
	}

	// Atomic: if any errors, write nothing
	if (errors.length > 0) {
		for (const e of errors) {
			console.error(e);
		}
		process.exitCode = 1;
		return;
	}

	// Validate merged values against schema
	const partial: Record<string, unknown> = {};
	for (const { key, value } of parsed) {
		setNestedValue(partial, key, value);
	}
	try {
		ConfigSchema.parse({ ...partial });
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		console.error(`Validation error: ${msg}`);
		process.exitCode = 1;
		return;
	}

	try {
		readMergeWriteConfig(parsed);
	} catch (err) {
		const code = (err as NodeJS.ErrnoException).code;
		const msg = code === "EACCES"
			? `Permission denied writing to ${path.join(getLocalDir(process.cwd()), CONFIG_FILE)}`
			: `Failed to write config: ${(err as Error).message}`;
		console.error(msg);
		process.exitCode = 1;
		return;
	}

	for (const { key, value } of parsed) {
		console.log(`Set ${key} = ${String(value)}`);
	}
}

function checkCancel(value: unknown): void {
	if (clack.isCancel(value)) {
		clack.cancel("Config editor cancelled.");
		process.exit(0);
	}
}

interface CliDetection {
	installed: boolean;
	version: string | null;
	authenticated: boolean;
	binaryPath: string | null;
}

type DetectAllResult = Record<CliName, CliDetection>;

async function loadModelOptions(cli: CliName): Promise<{ value: string; label: string }[]> {
	try {
		const models = await listModels({ cli });
		return [
			{ value: "default", label: "default" },
			...models.map((m) => ({ value: m.id, label: `${m.name} (${m.id})` })),
		];
	} catch {
		return [{ value: "default", label: "default" }];
	}
}

async function promptForValue(key: string, currentValue: unknown): Promise<unknown> {
	const type = VALID_KEYS[key];

	if (key === "plan.cli" || key === "build.cli") {
		const s = clack.spinner();
		s.start("Detecting installed CLIs...");
		const detectResult = (await detectAll()) as DetectAllResult;
		const installed = (Object.entries(detectResult) as [CliName, CliDetection][])
			.filter(([, info]) => info.installed)
			.map(([name]) => name);
		// Ensure current value is included
		const cliSet = new Set(installed);
		if (currentValue && !cliSet.has(currentValue as CliName)) {
			cliSet.add(currentValue as CliName);
		}
		s.stop("CLI detection complete.");

		const result = await clack.select({
			message: `Select CLI for ${key.split(".")[0]}`,
			options: Array.from(cliSet).map((name) => ({ value: name, label: name })),
			initialValue: currentValue as string,
		});
		checkCancel(result);
		return result;
	}

	if (key === "plan.model" || key === "build.model") {
		const cliKey = key.replace(".model", ".cli");
		const config = loadConfig();
		const cli = getNestedValue(config as unknown as Record<string, unknown>, cliKey) as CliName;
		const s = clack.spinner();
		s.start(`Loading models for ${cli}...`);
		const options = await loadModelOptions(cli);
		s.stop("Models loaded.");

		const result = await clack.select({
			message: `Select model for ${key.split(".")[0]} (${cli})`,
			options,
			initialValue: currentValue as string,
		});
		checkCancel(result);
		return result;
	}

	if (type === "number") {
		const result = await clack.text({
			message: `Enter value for ${key}`,
			placeholder: String(currentValue),
			defaultValue: String(currentValue),
			validate(val) {
				const n = Number(val);
				if (Number.isNaN(n) || !Number.isInteger(n) || n <= 0) {
					return "Must be a positive integer";
				}
			},
		});
		checkCancel(result);
		return Number(result);
	}

	if (type === "boolean") {
		const result = await clack.select({
			message: `Set ${key}`,
			options: [
				{ value: "true", label: "true" },
				{ value: "false", label: "false" },
			],
			initialValue: String(currentValue),
		});
		checkCancel(result);
		return result === "true";
	}

	// String fields
	const result = await clack.text({
		message: `Enter value for ${key}`,
		placeholder: String(currentValue),
		defaultValue: String(currentValue),
	});
	checkCancel(result);
	return (result as string).trim() || currentValue;
}

async function runInteractiveConfig(): Promise<void> {
	clack.intro("toby config");

	const config = loadConfig();
	const configObj = config as unknown as Record<string, unknown>;

	const keyChoice = await clack.select({
		message: "Which setting to edit?",
		options: Object.keys(VALID_KEYS).map((key) => ({
			value: key,
			label: key,
			hint: String(getNestedValue(configObj, key)),
		})),
	});
	checkCancel(keyChoice);

	const key = keyChoice as string;
	const currentValue = getNestedValue(configObj, key);
	const newValue = await promptForValue(key, currentValue);

	readMergeWriteConfig([{ key, value: newValue }]);
	clack.outro(`${chalk.green("✔")} Updated ${key} = ${String(newValue)}`);
}

export interface RunConfigOpts {
	subcommand?: string;
	args?: string[];
	version?: string;
}

/** Main entry point for the config command. */
export async function runConfig(opts: RunConfigOpts = {}): Promise<void> {
	const { subcommand } = opts;
	const rest = opts.args ?? [];

	// No subcommand → interactive editor
	if (!subcommand) {
		if (!isTTY()) {
			console.error("Interactive config editor requires a TTY.\nUse: toby config get <key> | toby config set <key> <value>");
			process.exitCode = 1;
			return;
		}
		await runInteractiveConfig();
		return;
	}

	if (subcommand === "get") {
		if (rest.length === 0) {
			configListAll();
			return;
		}
		configGet(rest[0]);
		return;
	}

	if (subcommand === "set") {
		// Batch mode: toby config set k1=v1 k2=v2
		if (rest.some((arg) => arg.includes("="))) {
			configSetBatch(rest.filter((arg) => arg.includes("=")));
			return;
		}

		const [key, value] = rest;
		if (!key) {
			console.error("Missing key for config set.\nUsage: toby config set <key> <value>");
			process.exitCode = 1;
			return;
		}
		if (!value) {
			console.error(`Missing value for config set.\nUsage: toby config set <key> <value>`);
			process.exitCode = 1;
			return;
		}
		configSet(key, value);
		return;
	}

	console.error(`Unknown config subcommand: ${subcommand}\nUsage: toby config [get <key> | set <key> <value>]`);
	process.exitCode = 1;
}
