import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render } from "ink-testing-library";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import Init, { createProject, getInstalledClis } from "./init.js";
import type { InitSelections } from "./init.js";

// Mock spawner
vi.mock("@0xtiby/spawner", () => ({
	detectAll: vi.fn(),
	getKnownModels: vi.fn(() => [
		{ id: "claude-sonnet-4-20250514", name: "Claude Sonnet 4" },
	]),
}));

// Mock useApp to avoid exit issues in tests
vi.mock("ink", async () => {
	const actual = await vi.importActual<typeof import("ink")>("ink");
	return {
		...actual,
		useApp: () => ({ exit: vi.fn() }),
	};
});

import { detectAll } from "@0xtiby/spawner";

const mockDetectAll = detectAll as ReturnType<typeof vi.fn>;

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
};

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

	it("creates .toby/prd directory", () => {
		createProject(DEFAULT_SELECTIONS, tmpDir);
		expect(fs.existsSync(path.join(tmpDir, ".toby", "prd"))).toBe(true);
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

describe("Init component", () => {
	it("shows detecting message initially", () => {
		mockDetectAll.mockReturnValue(new Promise(() => {}));
		const { lastFrame } = render(<Init version="0.1.0" />);
		expect(lastFrame()).toContain("Detecting installed CLIs");
	});

	it("shows error when no CLIs installed", async () => {
		mockDetectAll.mockResolvedValue(
			makeDetectResult({
				claude: {
					installed: false,
					version: null,
					authenticated: false,
					binaryPath: null,
				},
			}),
		);
		const { lastFrame } = render(<Init version="0.1.0" />);
		await vi.waitFor(() => {
			expect(lastFrame()).toContain("No AI CLIs found");
		});
	});

	it("shows CLI selection after detection", async () => {
		mockDetectAll.mockResolvedValue(makeDetectResult());
		const { lastFrame } = render(<Init version="0.1.0" />);
		await vi.waitFor(() => {
			expect(lastFrame()).toContain("Select CLI for planning");
			expect(lastFrame()).toContain("claude");
		});
	});

	it("shows detected CLIs with version and auth info", async () => {
		mockDetectAll.mockResolvedValue(makeDetectResult());
		const { lastFrame } = render(<Init version="0.1.0" />);
		await vi.waitFor(() => {
			expect(lastFrame()).toContain("2.1.80");
			expect(lastFrame()).toContain("authenticated");
		});
	});

	it("shows install instructions for missing CLIs", async () => {
		mockDetectAll.mockResolvedValue(
			makeDetectResult({
				claude: {
					installed: false,
					version: null,
					authenticated: false,
					binaryPath: null,
				},
			}),
		);
		const { lastFrame } = render(<Init version="0.1.0" />);
		await vi.waitFor(() => {
			expect(lastFrame()).toContain("npm install -g @anthropic-ai/claude-code");
			expect(lastFrame()).toContain("npm install -g @openai/codex");
		});
	});
});
