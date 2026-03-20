import React, { useState, useEffect } from "react";
import { Text, Box, useApp } from "ink";
import SelectInput from "ink-select-input";
import TextInput from "ink-text-input";
import fs from "node:fs";
import path from "node:path";
import { detectAll, getKnownModels } from "@0xtiby/spawner";
import { loadConfig, writeConfig } from "../lib/config.js";
import { getLocalDir, CONFIG_FILE } from "../lib/paths.js";
import { ConfigSchema } from "../types.js";
import type { TobyConfig } from "../types.js";

type CliName = "claude" | "codex" | "opencode";

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

	const cwd = process.cwd();
	const localDir = getLocalDir(cwd);
	if (!fs.existsSync(localDir)) {
		return (
			<Box flexDirection="column">
				<Text color="red" bold>No config found</Text>
				<Text>{"Run "}<Text color="cyan">toby init</Text>{" to set up your project."}</Text>
			</Box>
		);
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

	try {
		writeConfig(existing as Partial<TobyConfig>, configPath);
	} catch (err) {
		const code = (err as NodeJS.ErrnoException).code;
		const msg = code === "EACCES"
			? `Permission denied writing to ${configPath}`
			: `Failed to write config: ${(err as Error).message}`;
		return <Text color="red">{msg}</Text>;
	}

	return <Text color="green">{`Set ${configKey} = ${String(parsed)}`}</Text>;
}

type EditorPhase =
	| "loading"
	| "plan_cli"
	| "plan_model"
	| "plan_iterations"
	| "build_cli"
	| "build_model"
	| "build_iterations"
	| "specs_dir"
	| "verbose"
	| "saving"
	| "done";

interface EditorValues {
	planCli: CliName;
	planModel: string;
	planIterations: number;
	buildCli: CliName;
	buildModel: string;
	buildIterations: number;
	specsDir: string;
	verbose: boolean;
}

function modelItems(cli: CliName) {
	const models = getKnownModels(cli);
	return [
		{ label: "default", value: "default" },
		...models.map((m) => ({ label: `${m.name} (${m.id})`, value: m.id })),
	];
}

/** Build EditorValues from a loaded TobyConfig */
export function configToEditorValues(config: TobyConfig): EditorValues {
	return {
		planCli: config.plan.cli,
		planModel: config.plan.model,
		planIterations: config.plan.iterations,
		buildCli: config.build.cli,
		buildModel: config.build.model,
		buildIterations: config.build.iterations,
		specsDir: config.specsDir,
		verbose: config.verbose,
	};
}

/** Build a partial TobyConfig from EditorValues for saving */
export function editorValuesToConfig(values: EditorValues): Partial<TobyConfig> {
	return {
		plan: {
			cli: values.planCli,
			model: values.planModel,
			iterations: values.planIterations,
		},
		build: {
			cli: values.buildCli,
			model: values.buildModel,
			iterations: values.buildIterations,
		},
		specsDir: values.specsDir,
		verbose: values.verbose,
	};
}

function CompletedField({ label, value }: { label: string; value: string }) {
	return (
		<Text>
			{"  "}
			<Text dimColor>{label}:</Text> {value}
		</Text>
	);
}

export function ConfigEditor({ version }: { version: string }) {
	const { exit } = useApp();
	const [phase, setPhase] = useState<EditorPhase>("loading");
	const [installedClis, setInstalledClis] = useState<CliName[]>([]);
	const [values, setValues] = useState<EditorValues>({
		planCli: "claude",
		planModel: "default",
		planIterations: 2,
		buildCli: "claude",
		buildModel: "default",
		buildIterations: 10,
		specsDir: "specs",
		verbose: false,
	});
	const [iterInput, setIterInput] = useState("");
	const [specsDirInput, setSpecsDirInput] = useState("");
	const [saveError, setSaveError] = useState<string | null>(null);

	useEffect(() => {
		if (phase !== "loading") return;

		const config = loadConfig();
		const initial = configToEditorValues(config);
		setValues(initial);

		detectAll().then((result) => {
			const installed = (Object.entries(result) as [CliName, { installed: boolean }][])
				.filter(([, info]) => info.installed)
				.map(([name]) => name);

			// Ensure current config CLIs are included even if not detected
			const cliSet = new Set(installed);
			if (!cliSet.has(initial.planCli)) cliSet.add(initial.planCli);
			if (!cliSet.has(initial.buildCli)) cliSet.add(initial.buildCli);

			setInstalledClis(Array.from(cliSet));
			setPhase("plan_cli");
		});
	}, [phase]);

	function cliItems(currentValue: CliName) {
		return installedClis.map((name) => ({
			label: name,
			value: name,
			...(name === currentValue ? {} : {}),
		}));
	}

	function initialIndex(items: { value: string }[], currentValue: string): number {
		const idx = items.findIndex((i) => i.value === currentValue);
		return idx >= 0 ? idx : 0;
	}

	function handleSave() {
		const cwd = process.cwd();
		const configPath = path.join(getLocalDir(cwd), CONFIG_FILE);
		const partial = editorValuesToConfig(values);
		try {
			writeConfig(partial, configPath);
		} catch (err) {
			const code = (err as NodeJS.ErrnoException).code;
			const msg = code === "EACCES"
				? `Permission denied writing to ${configPath}`
				: `Failed to save config: ${(err as Error).message}`;
			setSaveError(msg);
		}
		setPhase("done");
		exit();
	}

	if (phase === "loading") {
		return <Text>Loading configuration...</Text>;
	}

	const planCliItems = cliItems(values.planCli);
	const buildCliItems = cliItems(values.buildCli);

	return (
		<Box flexDirection="column">
			<Text bold>{`toby v${version} — config editor\n`}</Text>

			{/* Plan section */}
			<Text bold color="cyan">Plan</Text>

			{phase === "plan_cli" && (
				<Box flexDirection="column">
					<Text>  cli:</Text>
					<SelectInput
						items={planCliItems}
						initialIndex={initialIndex(planCliItems, values.planCli)}
						onSelect={(item) => {
							setValues((v) => ({ ...v, planCli: item.value as CliName }));
							setPhase("plan_model");
						}}
					/>
				</Box>
			)}

			{phase !== "plan_cli" && (
				<CompletedField label="cli" value={values.planCli} />
			)}

			{phase === "plan_model" && (
				<Box flexDirection="column">
					<Text>  model:</Text>
					<SelectInput
						items={modelItems(values.planCli)}
						initialIndex={initialIndex(modelItems(values.planCli), values.planModel)}
						onSelect={(item) => {
							setValues((v) => ({ ...v, planModel: item.value }));
							setIterInput(String(values.planIterations));
							setPhase("plan_iterations");
						}}
					/>
				</Box>
			)}

			{!["loading", "plan_cli", "plan_model"].includes(phase) && (
				<CompletedField label="model" value={values.planModel} />
			)}

			{phase === "plan_iterations" && (
				<Box>
					<Text>  iterations: </Text>
					<TextInput
						value={iterInput}
						onChange={setIterInput}
						onSubmit={(val) => {
							const n = Number(val);
							if (!Number.isNaN(n) && n > 0 && Number.isInteger(n)) {
								setValues((v) => ({ ...v, planIterations: n }));
							}
							setPhase("build_cli");
						}}
					/>
				</Box>
			)}

			{!["loading", "plan_cli", "plan_model", "plan_iterations"].includes(phase) && (
				<CompletedField label="iterations" value={String(values.planIterations)} />
			)}

			{/* Build section - show after plan is done */}
			{!["loading", "plan_cli", "plan_model", "plan_iterations"].includes(phase) && (
				<>
					<Text>{""}</Text>
					<Text bold color="cyan">Build</Text>
				</>
			)}

			{phase === "build_cli" && (
				<Box flexDirection="column">
					<Text>  cli:</Text>
					<SelectInput
						items={buildCliItems}
						initialIndex={initialIndex(buildCliItems, values.buildCli)}
						onSelect={(item) => {
							setValues((v) => ({ ...v, buildCli: item.value as CliName }));
							setPhase("build_model");
						}}
					/>
				</Box>
			)}

			{!["loading", "plan_cli", "plan_model", "plan_iterations", "build_cli"].includes(phase) && (
				<CompletedField label="cli" value={values.buildCli} />
			)}

			{phase === "build_model" && (
				<Box flexDirection="column">
					<Text>  model:</Text>
					<SelectInput
						items={modelItems(values.buildCli)}
						initialIndex={initialIndex(modelItems(values.buildCli), values.buildModel)}
						onSelect={(item) => {
							setValues((v) => ({ ...v, buildModel: item.value }));
							setIterInput(String(values.buildIterations));
							setPhase("build_iterations");
						}}
					/>
				</Box>
			)}

			{!["loading", "plan_cli", "plan_model", "plan_iterations", "build_cli", "build_model"].includes(phase) && (
				<CompletedField label="model" value={values.buildModel} />
			)}

			{phase === "build_iterations" && (
				<Box>
					<Text>  iterations: </Text>
					<TextInput
						value={iterInput}
						onChange={setIterInput}
						onSubmit={(val) => {
							const n = Number(val);
							if (!Number.isNaN(n) && n > 0 && Number.isInteger(n)) {
								setValues((v) => ({ ...v, buildIterations: n }));
							}
							setSpecsDirInput(values.specsDir);
							setPhase("specs_dir");
						}}
					/>
				</Box>
			)}

			{!["loading", "plan_cli", "plan_model", "plan_iterations", "build_cli", "build_model", "build_iterations"].includes(phase) && (
				<CompletedField label="iterations" value={String(values.buildIterations)} />
			)}

			{/* General section */}
			{!["loading", "plan_cli", "plan_model", "plan_iterations", "build_cli", "build_model", "build_iterations"].includes(phase) && (
				<>
					<Text>{""}</Text>
					<Text bold color="cyan">General</Text>
				</>
			)}

			{phase === "specs_dir" && (
				<Box>
					<Text>  specsDir: </Text>
					<TextInput
						value={specsDirInput}
						onChange={setSpecsDirInput}
						onSubmit={(val) => {
							const dir = val.trim() || values.specsDir;
							setValues((v) => ({ ...v, specsDir: dir }));
							setPhase("verbose");
						}}
					/>
				</Box>
			)}

			{!["loading", "plan_cli", "plan_model", "plan_iterations", "build_cli", "build_model", "build_iterations", "specs_dir"].includes(phase) && (
				<CompletedField label="specsDir" value={values.specsDir} />
			)}

			{phase === "verbose" && (
				<Box flexDirection="column">
					<Text>  verbose:</Text>
					<SelectInput
						items={[
							{ label: "false", value: "false" },
							{ label: "true", value: "true" },
						]}
						initialIndex={values.verbose ? 1 : 0}
						onSelect={(item) => {
							setValues((v) => ({ ...v, verbose: item.value === "true" }));
							handleSave();
						}}
					/>
				</Box>
			)}

			{phase === "done" && (
				<>
					<CompletedField label="verbose" value={String(values.verbose)} />
					<Text>{""}</Text>
					{saveError ? (
						<Text color="red" bold>✗ {saveError}</Text>
					) : (
						<Text color="green" bold>✓ Config saved</Text>
					)}
				</>
			)}
		</Box>
	);
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
