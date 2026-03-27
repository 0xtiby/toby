import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
	createProject,
	getInstalledClis,
	hasAllInitFlags,
	runInit,
} from "./init.js";
import type { InitSelections, InitFlags } from "./init.js";

// Mock spawner
vi.mock("@0xtiby/spawner", () => ({
	detectAll: vi.fn(),
	listModels: vi.fn(async () => [
		{
			id: "claude-sonnet-4-20250514",
			name: "Claude Sonnet 4",
			provider: "anthropic",
		},
	]),
}));

// Mock clack (interactive tests are out of scope, but prevent real prompts)
vi.mock("@clack/prompts", () => ({
	intro: vi.fn(),
	outro: vi.fn(),
	cancel: vi.fn(),
	select: vi.fn(),
	text: vi.fn(),
	confirm: vi.fn(),
	spinner: vi.fn(() => ({ start: vi.fn(), stop: vi.fn() })),
	note: vi.fn(),
	isCancel: vi.fn(() => false),
}));

vi.mock("../ui/tty.js", () => ({
	isTTY: vi.fn(),
}));

import { detectAll } from "@0xtiby/spawner";
import { isTTY } from "../ui/tty.js";

const mockDetectAll = detectAll as ReturnType<typeof vi.fn>;
const mockIsTTY = isTTY as ReturnType<typeof vi.fn>;

function makeDetectResult(overrides: Record<string, unknown> = {}) {
	return {
		claude: {
			installed: true,
			version: "2.1.80",
			authenticated: true,
			binaryPath: "claude",
		},
		codex: {
			installed: false,
			version: null,
			authenticated: false,
			binaryPath: null,
		},
		opencode: {
			installed: false,
			version: null,
			authenticated: false,
			binaryPath: null,
		},
		...overrides,
	};
}

const DEFAULT_SELECTIONS: InitSelections = {
	planCli: "claude",
	planModel: "default",
	buildCli: "claude",
	buildModel: "default",
	specsDir: "specs",
	verbose: false,
};

const ALL_FLAGS: InitFlags = {
	planCli: "claude",
	planModel: "default",
	buildCli: "claude",
	buildModel: "default",
	specsDir: "specs",
};

// ── Pure function tests ─────────────────────────────────────────

describe("createProject", () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "toby-init-test-"));
	});

	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	it("creates .toby/config.json with correct structure", () => {
		createProject(DEFAULT_SELECTIONS, tmpDir);

		const configPath = path.join(tmpDir, ".toby", "config.json");
		expect(fs.existsSync(configPath)).toBe(true);

		const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
		expect(config.plan.cli).toBe("claude");
		expect(config.plan.model).toBe("default");
		expect(config.plan.iterations).toBe(2);
		expect(config.build.cli).toBe("claude");
		expect(config.build.model).toBe("default");
		expect(config.build.iterations).toBe(10);
		expect(config.specsDir).toBe("specs");
		expect(config.templateVars).toEqual({
			PRD_PATH: ".toby/{{SPEC_NAME}}.prd.json",
		});
		expect(config.plan.templateVars).toBeUndefined();
		expect(config.build.templateVars).toBeUndefined();
	});

	it("creates .toby/status.json when missing", () => {
		const result = createProject(DEFAULT_SELECTIONS, tmpDir);

		const statusPath = path.join(tmpDir, ".toby", "status.json");
		expect(fs.existsSync(statusPath)).toBe(true);
		expect(result.statusCreated).toBe(true);

		const status = JSON.parse(fs.readFileSync(statusPath, "utf-8"));
		expect(status).toEqual({ specs: {} });
	});

	it("preserves existing status.json on re-run", () => {
		const localDir = path.join(tmpDir, ".toby");
		fs.mkdirSync(localDir, { recursive: true });
		const existingStatus = {
			specs: {
				"01-auth": {
					status: "planned",
					plannedAt: null,
					iterations: [],
				},
			},
		};
		fs.writeFileSync(
			path.join(localDir, "status.json"),
			JSON.stringify(existingStatus),
		);

		const result = createProject(DEFAULT_SELECTIONS, tmpDir);
		expect(result.statusCreated).toBe(false);

		const status = JSON.parse(
			fs.readFileSync(path.join(localDir, "status.json"), "utf-8"),
		);
		expect(status.specs["01-auth"]).toBeDefined();
	});

	it("creates specs directory when missing", () => {
		const result = createProject(DEFAULT_SELECTIONS, tmpDir);

		expect(fs.existsSync(path.join(tmpDir, "specs"))).toBe(true);
		expect(result.specsDirCreated).toBe(true);
	});

	it("does not recreate existing specs directory", () => {
		fs.mkdirSync(path.join(tmpDir, "specs"), { recursive: true });

		const result = createProject(DEFAULT_SELECTIONS, tmpDir);
		expect(result.specsDirCreated).toBe(false);
	});

	it("uses custom specs directory name", () => {
		const sel = { ...DEFAULT_SELECTIONS, specsDir: "my-specs" };
		createProject(sel, tmpDir);

		expect(fs.existsSync(path.join(tmpDir, "my-specs"))).toBe(true);

		const config = JSON.parse(
			fs.readFileSync(path.join(tmpDir, ".toby", "config.json"), "utf-8"),
		);
		expect(config.specsDir).toBe("my-specs");
	});

	it("overwrites config.json on re-run", () => {
		createProject(DEFAULT_SELECTIONS, tmpDir);
		createProject({ ...DEFAULT_SELECTIONS, planCli: "codex" }, tmpDir);

		const config = JSON.parse(
			fs.readFileSync(path.join(tmpDir, ".toby", "config.json"), "utf-8"),
		);
		expect(config.plan.cli).toBe("codex");
	});

	it("writes verbose: false to config when verbose is false", () => {
		createProject({ ...DEFAULT_SELECTIONS, verbose: false }, tmpDir);

		const config = JSON.parse(
			fs.readFileSync(path.join(tmpDir, ".toby", "config.json"), "utf-8"),
		);
		expect(config.verbose).toBe(false);
	});

	it("writes verbose: true to config when verbose is true", () => {
		createProject({ ...DEFAULT_SELECTIONS, verbose: true }, tmpDir);

		const config = JSON.parse(
			fs.readFileSync(path.join(tmpDir, ".toby", "config.json"), "utf-8"),
		);
		expect(config.verbose).toBe(true);
	});
});

describe("getInstalledClis", () => {
	it("returns only installed CLIs", () => {
		const result = getInstalledClis(makeDetectResult());
		expect(result).toEqual(["claude"]);
	});

	it("returns empty array when none installed", () => {
		const result = getInstalledClis(
			makeDetectResult({
				claude: {
					installed: false,
					version: null,
					authenticated: false,
					binaryPath: null,
				},
			}),
		);
		expect(result).toEqual([]);
	});

	it("returns multiple CLIs when installed", () => {
		const result = getInstalledClis(
			makeDetectResult({
				codex: {
					installed: true,
					version: "0.115.0",
					authenticated: true,
					binaryPath: "codex",
				},
			}),
		);
		expect(result).toEqual(["claude", "codex"]);
	});
});

describe("hasAllInitFlags", () => {
	it("returns true when all 5 flags present", () => {
		expect(hasAllInitFlags(ALL_FLAGS)).toBe(true);
	});

	it("returns true when all 5 flags plus verbose are present", () => {
		expect(hasAllInitFlags({ ...ALL_FLAGS, verbose: true })).toBe(true);
	});

	it("returns false when any flag missing", () => {
		for (const key of [
			"planCli",
			"planModel",
			"buildCli",
			"buildModel",
			"specsDir",
		] as const) {
			const flags = { ...ALL_FLAGS, [key]: undefined };
			expect(hasAllInitFlags(flags)).toBe(false);
		}
	});
});

// ── runInit tests ───────────────────────────────────────────────

describe("runInit non-interactive", () => {
	let logOutput: string[];
	let errorOutput: string[];

	beforeEach(() => {
		logOutput = [];
		errorOutput = [];
		vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
			logOutput.push(args.map(String).join(" "));
		});
		vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
			errorOutput.push(args.map(String).join(" "));
		});
		mockIsTTY.mockReturnValue(true);
		process.exitCode = undefined;
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("creates project with valid flags and installed CLI", async () => {
		mockDetectAll.mockResolvedValue(makeDetectResult());
		await runInit({ ...ALL_FLAGS, force: true });
		expect(logOutput.join("\n")).toContain("Project initialized");
		expect(process.exitCode).toBeUndefined();
	});

	it("errors for unknown CLI value", async () => {
		mockDetectAll.mockResolvedValue(makeDetectResult());
		await runInit({ ...ALL_FLAGS, planCli: "unknown-cli" });
		expect(errorOutput.join("\n")).toContain("Unknown CLI: unknown-cli");
		expect(process.exitCode).toBe(1);
	});

	it("errors for uninstalled CLI", async () => {
		mockDetectAll.mockResolvedValue(
			makeDetectResult({
				codex: {
					installed: false,
					version: null,
					authenticated: false,
					binaryPath: null,
				},
			}),
		);
		await runInit({ ...ALL_FLAGS, planCli: "codex", force: true });
		expect(errorOutput.join("\n")).toContain("CLI not installed: codex");
		expect(process.exitCode).toBe(1);
	});

	it("errors when config exists and no --force", async () => {
		// .toby/config.json exists in cwd (the worktree), so no setup needed
		await runInit(ALL_FLAGS);
		expect(errorOutput.join("\n")).toContain(
			".toby/config.json already exists",
		);
		expect(process.exitCode).toBe(1);
	});

	it("succeeds when config exists with --force", async () => {
		mockDetectAll.mockResolvedValue(makeDetectResult());
		await runInit({ ...ALL_FLAGS, force: true });
		expect(logOutput.join("\n")).toContain("Project initialized");
		expect(process.exitCode).toBeUndefined();
	});

	it("defaults verbose to false when flag is omitted", async () => {
		mockDetectAll.mockResolvedValue(makeDetectResult());
		await runInit({ ...ALL_FLAGS, force: true });
		expect(logOutput.join("\n")).toContain("Project initialized");
	});
});

describe("runInit non-TTY", () => {
	let errorOutput: string[];

	beforeEach(() => {
		errorOutput = [];
		vi.spyOn(console, "log").mockImplementation(() => {});
		vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
			errorOutput.push(args.map(String).join(" "));
		});
		process.exitCode = undefined;
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("errors with guidance when not all flags provided", async () => {
		mockIsTTY.mockReturnValue(false);
		await runInit({ planCli: "claude" }); // missing most flags
		const output = errorOutput.join("\n");
		expect(output).toContain("requires an interactive terminal");
		expect(output).toContain("--planCli");
		expect(output).toContain("--specsDir");
		expect(process.exitCode).toBe(1);
	});
});
