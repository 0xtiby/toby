import React, { useState, useEffect } from "react";
import { Text, Box, useApp } from "ink";
import SelectInput from "ink-select-input";
import TextInput from "ink-text-input";
import fs from "node:fs";
import path from "node:path";
import { detectAll, getKnownModels } from "@0xtiby/spawner";
import { writeConfig } from "../lib/config.js";
import {
	getLocalDir,
	CONFIG_FILE,
	STATUS_FILE,
	DEFAULT_SPECS_DIR,
	PRD_DIR,
} from "../lib/paths.js";
import type { TobyConfig } from "../types.js";

export interface InitFlags {
	version: string;
	planCli?: string;
	planModel?: string;
	buildCli?: string;
	buildModel?: string;
	specsDir?: string;
}

type CliName = "claude" | "codex" | "opencode";

interface CliDetection {
	installed: boolean;
	version: string | null;
	authenticated: boolean;
	binaryPath: string | null;
}

type DetectAllResult = Record<CliName, CliDetection>;

type Phase =
	| "detecting"
	| "no_cli"
	| "plan_cli"
	| "plan_model"
	| "build_cli"
	| "build_model"
	| "specs_dir"
	| "done";

export interface InitSelections {
	planCli: CliName;
	planModel: string;
	buildCli: CliName;
	buildModel: string;
	specsDir: string;
}

export interface InitResult {
	configPath: string;
	statusCreated: boolean;
	specsDirCreated: boolean;
}

/** Create project files from wizard selections. Pure function, easily testable. */
export function createProject(
	selections: InitSelections,
	cwd: string = process.cwd(),
): InitResult {
	const localDir = getLocalDir(cwd);
	const configPath = path.join(localDir, CONFIG_FILE);
	const statusPath = path.join(localDir, STATUS_FILE);
	const prdPath = path.join(localDir, PRD_DIR);
	const specsPath = path.join(cwd, selections.specsDir);

	try {
		// Create .toby/ and prd/ directories
		fs.mkdirSync(localDir, { recursive: true });
		fs.mkdirSync(prdPath, { recursive: true });
	} catch (err) {
		const msg = (err as NodeJS.ErrnoException).code === "EACCES"
			? `Permission denied creating ${localDir}`
			: `Failed to create project directory: ${(err as Error).message}`;
		throw new Error(msg);
	}

	try {
		// Write config.json (always overwrite)
		const config: Partial<TobyConfig> = {
			plan: {
				cli: selections.planCli,
				model: selections.planModel,
				iterations: 2,
			},
			build: {
				cli: selections.buildCli,
				model: selections.buildModel,
				iterations: 10,
			},
			specsDir: selections.specsDir,
		};
		writeConfig(config, configPath);
	} catch (err) {
		throw new Error(
			`Failed to write config: ${(err as Error).message}`,
		);
	}

	// Write status.json only if missing (preserve existing)
	const statusCreated = !fs.existsSync(statusPath);
	if (statusCreated) {
		try {
			fs.writeFileSync(
				statusPath,
				JSON.stringify({ specs: {} }, null, 2) + "\n",
			);
		} catch (err) {
			throw new Error(
				`Failed to write status file: ${(err as Error).message}`,
			);
		}
	}

	// Create specs directory if missing
	const specsDirCreated = !fs.existsSync(specsPath);
	if (specsDirCreated) {
		fs.mkdirSync(specsPath, { recursive: true });
	}

	return { configPath, statusCreated, specsDirCreated };
}

/** Filter detectAll results to only installed CLIs */
export function getInstalledClis(
	result: DetectAllResult,
): CliName[] {
	return (Object.entries(result) as [CliName, CliDetection][])
		.filter(([, info]) => info.installed)
		.map(([name]) => name);
}

function CliTable({ clis }: { clis: DetectAllResult }) {
	return (
		<Box flexDirection="column" marginBottom={1}>
			<Text bold>Detected CLIs:</Text>
			{(Object.entries(clis) as [CliName, CliDetection][]).map(
				([name, info]) => (
					<Text key={name}>
						{"  "}
						{info.installed ? (
							<Text color="green">✓</Text>
						) : (
							<Text color="red">✗</Text>
						)}{" "}
						<Text bold>{name}</Text>
						{info.installed && (
							<Text dimColor>
								{" "}
								{info.version}
								{info.authenticated
									? " (authenticated)"
									: " (not authenticated)"}
							</Text>
						)}
					</Text>
				),
			)}
		</Box>
	);
}

function modelItems(cli: CliName) {
	const models = getKnownModels(cli);
	return [
		{ label: "default", value: "default" },
		...models.map((m) => ({ label: `${m.name} (${m.id})`, value: m.id })),
	];
}

const VALID_CLI_NAMES: CliName[] = ["claude", "codex", "opencode"];

/** Returns true when all 5 optional init flags are present (non-interactive mode). */
export function hasAllInitFlags(flags: InitFlags): boolean {
	return !!(
		flags.planCli &&
		flags.planModel &&
		flags.buildCli &&
		flags.buildModel &&
		flags.specsDir
	);
}

function NonInteractiveInit({ flags }: { flags: InitFlags }) {
	const { exit } = useApp();
	const [status, setStatus] = useState<
		| { type: "detecting" }
		| { type: "error"; message: string }
		| { type: "success"; result: InitResult; selections: InitSelections }
	>({ type: "detecting" });

	useEffect(() => {
		const planCli = flags.planCli!;
		const buildCli = flags.buildCli!;

		// Validate CLI names
		for (const cli of [planCli, buildCli]) {
			if (!VALID_CLI_NAMES.includes(cli as CliName)) {
				setStatus({
					type: "error",
					message: `Unknown CLI: ${cli}. Must be one of: claude, codex, opencode`,
				});
				process.exitCode = 1;
				exit();
				return;
			}
		}

		// Check CLIs are installed
		detectAll().then((detectResult: DetectAllResult) => {
			for (const cli of [planCli, buildCli]) {
				if (!detectResult[cli as CliName]?.installed) {
					setStatus({
						type: "error",
						message: `CLI not installed: ${cli}`,
					});
					process.exitCode = 1;
					exit();
					return;
				}
			}

			const selections: InitSelections = {
				planCli: planCli as CliName,
				planModel: flags.planModel!,
				buildCli: buildCli as CliName,
				buildModel: flags.buildModel!,
				specsDir: flags.specsDir!,
			};

			try {
				const result = createProject(selections);
				setStatus({ type: "success", result, selections });
			} catch (err) {
				setStatus({ type: "error", message: (err as Error).message });
				process.exitCode = 1;
			}
			exit();
		});
	}, []);

	if (status.type === "detecting") {
		return <Text>Detecting installed CLIs...</Text>;
	}

	if (status.type === "error") {
		return <Text color="red">{`✗ ${status.message}`}</Text>;
	}

	const { result, selections } = status;
	return (
		<Box flexDirection="column">
			<Text color="green" bold>✓ Project initialized!</Text>
			<Text dimColor>{"  created "}{path.relative(process.cwd(), result.configPath)}</Text>
			{result.statusCreated && <Text dimColor>{"  created .toby/status.json"}</Text>}
			{result.specsDirCreated && <Text dimColor>{"  created "}{selections.specsDir}/</Text>}
		</Box>
	);
}

export default function Init(flags: InitFlags) {
	if (hasAllInitFlags(flags)) {
		return <NonInteractiveInit flags={flags} />;
	}
	return <InteractiveInit version={flags.version} />;
}

function InteractiveInit({ version }: { version: string }) {
	const { exit } = useApp();
	const [phase, setPhase] = useState<Phase>("detecting");
	const [clis, setClis] = useState<DetectAllResult | null>(null);
	const [installedClis, setInstalledClis] = useState<CliName[]>([]);
	const [selections, setSelections] = useState<InitSelections>({
		planCli: "claude",
		planModel: "default",
		buildCli: "claude",
		buildModel: "default",
		specsDir: DEFAULT_SPECS_DIR,
	});
	const [specsDirInput, setSpecsDirInput] = useState(DEFAULT_SPECS_DIR);
	const [result, setResult] = useState<InitResult | null>(null);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		if (phase !== "detecting") return;
		detectAll().then((detectResult: DetectAllResult) => {
			setClis(detectResult);
			const installed = getInstalledClis(detectResult);
			setInstalledClis(installed);

			if (installed.length === 0) {
				setPhase("no_cli");
				exit();
			} else {
				setSelections((s) => ({
					...s,
					planCli: installed[0]!,
					buildCli: installed[0]!,
				}));
				setPhase("plan_cli");
			}
		});
	}, [phase]);

	function handlePlanCliSelect(item: { value: string }) {
		const cli = item.value as CliName;
		setSelections((s) => ({ ...s, planCli: cli }));
		setPhase("plan_model");
	}

	function handlePlanModelSelect(item: { value: string }) {
		setSelections((s) => ({ ...s, planModel: item.value }));
		setPhase("build_cli");
	}

	function handleBuildCliSelect(item: { value: string }) {
		const cli = item.value as CliName;
		setSelections((s) => ({ ...s, buildCli: cli }));
		setPhase("build_model");
	}

	function handleBuildModelSelect(item: { value: string }) {
		setSelections((s) => ({ ...s, buildModel: item.value }));
		setPhase("specs_dir");
	}

	function handleSpecsDirSubmit(value: string) {
		const dir = value.trim() || DEFAULT_SPECS_DIR;
		const final = { ...selections, specsDir: dir };
		setSelections(final);
		try {
			const res = createProject(final);
			setResult(res);
			setPhase("done");
		} catch (err) {
			setError((err as Error).message);
			setPhase("done");
		}
		exit();
	}

	if (phase === "detecting") {
		return <Text>Detecting installed CLIs...</Text>;
	}

	if (phase === "no_cli") {
		return (
			<Box flexDirection="column">
				{clis && <CliTable clis={clis} />}
				<Text color="red" bold>
					No AI CLIs found. Install one of the following:
				</Text>
				<Text>{"  • claude — npm install -g @anthropic-ai/claude-code"}</Text>
				<Text>{"  • codex  — npm install -g @openai/codex"}</Text>
				<Text>
					{"  • opencode — go install github.com/opencode-ai/opencode@latest"}
				</Text>
			</Box>
		);
	}

	const cliItems = installedClis.map((name) => ({
		label: `${name} — ${clis?.[name]?.version ?? "unknown"}`,
		value: name,
	}));

	return (
		<Box flexDirection="column">
			<Text bold>{`toby v${version} — project setup\n`}</Text>
			{clis && <CliTable clis={clis} />}

			{phase === "plan_cli" && (
				<Box flexDirection="column">
					<Text bold>Select CLI for planning:</Text>
					<SelectInput items={cliItems} onSelect={handlePlanCliSelect} />
				</Box>
			)}

			{phase === "plan_model" && (
				<Box flexDirection="column">
					<Text bold>
						Select model for planning ({selections.planCli}):
					</Text>
					<SelectInput
						items={modelItems(selections.planCli)}
						onSelect={handlePlanModelSelect}
					/>
				</Box>
			)}

			{phase === "build_cli" && (
				<Box flexDirection="column">
					<Text bold>Select CLI for building:</Text>
					<SelectInput items={cliItems} onSelect={handleBuildCliSelect} />
				</Box>
			)}

			{phase === "build_model" && (
				<Box flexDirection="column">
					<Text bold>
						Select model for building ({selections.buildCli}):
					</Text>
					<SelectInput
						items={modelItems(selections.buildCli)}
						onSelect={handleBuildModelSelect}
					/>
				</Box>
			)}

			{phase === "specs_dir" && (
				<Box flexDirection="column">
					<Text bold>Specs directory:</Text>
					<Box>
						<Text>{"  > "}</Text>
						<TextInput
							value={specsDirInput}
							onChange={setSpecsDirInput}
							onSubmit={handleSpecsDirSubmit}
						/>
					</Box>
				</Box>
			)}

			{phase === "done" && error && (
				<Box flexDirection="column" marginTop={1}>
					<Text color="red" bold>
						✗ Initialization failed
					</Text>
					<Text color="red">{`  ${error}`}</Text>
				</Box>
			)}

			{phase === "done" && result && (
				<Box flexDirection="column" marginTop={1}>
					<Text color="green" bold>
						✓ Project initialized!
					</Text>
					<Text>{""}</Text>
					<Text dimColor>
						{"  created "}
						{path.relative(process.cwd(), result.configPath)}
					</Text>
					{result.statusCreated && (
						<Text dimColor>{"  created .toby/status.json"}</Text>
					)}
					{result.specsDirCreated && (
						<Text dimColor>{"  created "}{selections.specsDir}/</Text>
					)}
					<Text>{""}</Text>
					<Text bold>Next steps:</Text>
					<Text>
						{"  1. Add spec files to "}
						{selections.specsDir}/
					</Text>
					<Text>
						{"  2. Run "}
						<Text color="cyan">toby plan</Text>
						{" to plan a spec"}
					</Text>
					<Text>
						{"  3. Run "}
						<Text color="cyan">toby build</Text>
						{" to build tasks"}
					</Text>
				</Box>
			)}
		</Box>
	);
}
