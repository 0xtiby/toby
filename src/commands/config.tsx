import React from "react";
import { Text, Box } from "ink";
import fs from "node:fs";
import path from "node:path";
import { loadConfig, writeConfig } from "../lib/config.js";
import { getLocalDir, CONFIG_FILE } from "../lib/paths.js";
import { ConfigSchema } from "../types.js";
import type { TobyConfig } from "../types.js";

export interface ConfigFlags {
	subcommand?: string;
	configKey?: string;
	value?: string;
	version: string;
}

/** All valid dot-notation keys and their expected types */
const VALID_KEYS: Record<string, "string" | "number" | "boolean" | "string[]"> = {
	"plan.cli": "string",
	"plan.model": "string",
	"plan.iterations": "number",
	"build.cli": "string",
	"build.model": "string",
	"build.iterations": "number",
	specsDir: "string",
	verbose: "boolean",
};

function getNestedValue(obj: Record<string, unknown>, key: string): unknown {
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

function setNestedValue(obj: Record<string, unknown>, key: string, value: unknown): void {
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

function parseValue(raw: string, type: "string" | "number" | "boolean" | "string[]"): unknown {
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

function ConfigGet({ configKey }: { configKey: string }) {
	if (!(configKey in VALID_KEYS)) {
		return <Text color="red">{`Unknown config key: ${configKey}\nValid keys: ${Object.keys(VALID_KEYS).join(", ")}`}</Text>;
	}

	const config = loadConfig();
	const value = getNestedValue(config as unknown as Record<string, unknown>, configKey);
	return <Text>{String(value)}</Text>;
}

function ConfigSet({ configKey, value }: { configKey: string; value: string }) {
	if (!(configKey in VALID_KEYS)) {
		return <Text color="red">{`Unknown config key: ${configKey}\nValid keys: ${Object.keys(VALID_KEYS).join(", ")}`}</Text>;
	}

	const type = VALID_KEYS[configKey];
	let parsed: unknown;
	try {
		parsed = parseValue(value, type);
	} catch (err) {
		return <Text color="red">{`Invalid value for ${configKey}: ${(err as Error).message}`}</Text>;
	}

	// Build a partial config object and validate against schema
	const partial: Record<string, unknown> = {};
	setNestedValue(partial, configKey, parsed);

	try {
		// Validate by parsing partial through schema (with defaults stripped)
		ConfigSchema.parse({ ...partial });
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		return <Text color="red">{`Validation error for ${configKey}: ${msg}`}</Text>;
	}

	// Read existing local config, merge, and write
	const cwd = process.cwd();
	const configPath = path.join(getLocalDir(cwd), CONFIG_FILE);
	let existing: Record<string, unknown> = {};
	try {
		const content = fs.readFileSync(configPath, "utf-8");
		existing = JSON.parse(content);
	} catch {
		// File doesn't exist yet, start fresh
	}

	setNestedValue(existing, configKey, parsed);
	writeConfig(existing as Partial<TobyConfig>, configPath);

	return <Text color="green">{`Set ${configKey} = ${String(parsed)}`}</Text>;
}

function UnknownSubcommand({ subcommand }: { subcommand: string }) {
	return (
		<Text color="red">
			{`Unknown config subcommand: ${subcommand}\nUsage: toby config [get <key> | set <key> <value>]`}
		</Text>
	);
}

export default function Config({
	subcommand,
	configKey,
	value,
	version,
}: ConfigFlags) {
	if (subcommand && subcommand !== "get" && subcommand !== "set") {
		return (
			<Box flexDirection="column">
				<Text>{`toby v${version}`}</Text>
				<Text>{""}</Text>
				<UnknownSubcommand subcommand={subcommand} />
			</Box>
		);
	}

	if (subcommand === "get" && configKey) {
		return <ConfigGet configKey={configKey} />;
	}

	if (subcommand === "set" && configKey && value) {
		return <ConfigSet configKey={configKey} value={value} />;
	}

	if (subcommand === "set" && configKey && !value) {
		return (
			<Text color="red">
				{`Missing value for config set.\nUsage: toby config set <key> <value>`}
			</Text>
		);
	}

	return (
		<Box flexDirection="column">
			<Text>{`toby v${version}`}</Text>
			<Text>{""}</Text>
			<Text>Usage: toby config [get &lt;key&gt; | set &lt;key&gt; &lt;value&gt;]</Text>
			<Text>{""}</Text>
			<Text bold>Available keys:</Text>
			{Object.entries(VALID_KEYS).map(([key, type]) => (
				<Text key={key}>{`  ${key} (${type})`}</Text>
			))}
		</Box>
	);
}
