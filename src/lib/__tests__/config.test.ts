import { describe, it, expect, vi, beforeEach } from "vitest";
import path from "node:path";
import os from "node:os";

vi.mock("node:fs", () => ({
	default: {
		readFileSync: vi.fn(),
		existsSync: vi.fn(() => false),
	},
	readFileSync: vi.fn(),
	existsSync: vi.fn(() => false),
}));

import fs from "node:fs";
import {
	loadGlobalConfig,
	loadLocalConfig,
	mergeConfigs,
	loadConfig,
	resolveCommandConfig,
} from "../config.js";

const globalConfigPath = path.join(os.homedir(), ".toby", "config.json");

function mockConfigFile(filePath: string, content: unknown) {
	vi.mocked(fs.readFileSync).mockImplementation((p) => {
		if (p === filePath) return JSON.stringify(content);
		throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
	});
	vi.mocked(fs.existsSync).mockImplementation((p) => p === filePath);
}

function mockMultipleConfigs(files: Record<string, unknown>) {
	vi.mocked(fs.readFileSync).mockImplementation((p) => {
		const content = files[p as string];
		if (content !== undefined) return JSON.stringify(content);
		throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
	});
	vi.mocked(fs.existsSync).mockImplementation(
		(p) => (p as string) in files,
	);
}

describe("config", () => {
	beforeEach(() => {
		vi.mocked(fs.readFileSync).mockReset();
		vi.mocked(fs.existsSync).mockReset();
		vi.mocked(fs.existsSync).mockReturnValue(false);
		vi.mocked(fs.readFileSync).mockImplementation(() => {
			throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
		});
	});

	describe("loadGlobalConfig", () => {
		it("returns {} when no global config exists", () => {
			expect(loadGlobalConfig()).toEqual({});
		});

		it("returns parsed config when file exists", () => {
			mockConfigFile(globalConfigPath, { verbose: true });
			expect(loadGlobalConfig()).toEqual({ verbose: true });
		});

		it("returns {} and warns on corrupted JSON", () => {
			const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
			vi.mocked(fs.readFileSync).mockReturnValue("not json{{{");
			vi.mocked(fs.existsSync).mockReturnValue(true);

			expect(loadGlobalConfig()).toEqual({});
			expect(warnSpy).toHaveBeenCalledWith(
				expect.stringContaining("corrupted config"),
			);
			warnSpy.mockRestore();
		});
	});

	describe("loadLocalConfig", () => {
		it("returns {} when no local config exists", () => {
			expect(loadLocalConfig("/tmp/proj")).toEqual({});
		});

		it("returns parsed config when file exists", () => {
			const localPath = "/tmp/proj/.toby/config.json";
			mockConfigFile(localPath, { specsDir: "docs" });
			expect(loadLocalConfig("/tmp/proj")).toEqual({ specsDir: "docs" });
		});
	});

	describe("mergeConfigs", () => {
		it("deep-merges nested plan/build objects", () => {
			const global = { plan: { cli: "codex" as const, model: "gpt-4" } };
			const local = { plan: { cli: "claude" as const } };
			const result = mergeConfigs(global, local);
			expect(result).toEqual({
				plan: { cli: "claude", model: "gpt-4" },
			});
		});

		it("local overrides global for top-level keys", () => {
			const result = mergeConfigs(
				{ verbose: false, specsDir: "specs" },
				{ verbose: true },
			);
			expect(result).toEqual({ verbose: true, specsDir: "specs" });
		});

		it("handles empty configs", () => {
			expect(mergeConfigs({}, {})).toEqual({});
		});
	});

	describe("loadConfig", () => {
		it("returns all defaults when no config files exist", () => {
			const config = loadConfig("/tmp/proj");
			expect(config.plan.cli).toBe("claude");
			expect(config.plan.model).toBe("default");
			expect(config.plan.iterations).toBe(2);
			expect(config.build.cli).toBe("claude");
			expect(config.build.iterations).toBe(10);
			expect(config.specsDir).toBe("specs");
			expect(config.excludeSpecs).toEqual(["README.md"]);
			expect(config.verbose).toBe(false);
		});

		it("applies global config with defaults for rest", () => {
			mockConfigFile(globalConfigPath, { verbose: true });
			const config = loadConfig("/tmp/proj");
			expect(config.verbose).toBe(true);
			expect(config.plan.cli).toBe("claude");
		});

		it("local overrides global for same key", () => {
			mockMultipleConfigs({
				[globalConfigPath]: { verbose: false, specsDir: "global-specs" },
				"/tmp/proj/.toby/config.json": { verbose: true },
			});
			const config = loadConfig("/tmp/proj");
			expect(config.verbose).toBe(true);
			expect(config.specsDir).toBe("global-specs");
		});

		it("local partial config merges with defaults", () => {
			mockConfigFile("/tmp/proj/.toby/config.json", { verbose: true });
			const config = loadConfig("/tmp/proj");
			expect(config.verbose).toBe(true);
			expect(config.plan.iterations).toBe(2);
			expect(config.build.iterations).toBe(10);
		});

		it("empty object returns all defaults", () => {
			mockConfigFile(globalConfigPath, {});
			const config = loadConfig("/tmp/proj");
			expect(config.plan.cli).toBe("claude");
			expect(config.verbose).toBe(false);
		});

		it("corrupted JSON returns defaults", () => {
			const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
			vi.mocked(fs.readFileSync).mockReturnValue("{bad json");
			vi.mocked(fs.existsSync).mockReturnValue(true);

			const config = loadConfig("/tmp/proj");
			expect(config.plan.cli).toBe("claude");
			expect(config.verbose).toBe(false);
			warnSpy.mockRestore();
		});

		it("strips unknown keys", () => {
			mockConfigFile(globalConfigPath, {
				verbose: true,
				unknownKey: "should be stripped",
			});
			const config = loadConfig("/tmp/proj");
			expect(config).not.toHaveProperty("unknownKey");
			expect(config.verbose).toBe(true);
		});

		it("deep-merges plan/build across global and local", () => {
			mockMultipleConfigs({
				[globalConfigPath]: { plan: { cli: "codex", model: "gpt-4" } },
				"/tmp/proj/.toby/config.json": { plan: { cli: "claude" } },
			});
			const config = loadConfig("/tmp/proj");
			expect(config.plan.cli).toBe("claude");
			expect(config.plan.model).toBe("gpt-4");
			expect(config.plan.iterations).toBe(2);
		});
	});

	describe("resolveCommandConfig", () => {
		it("returns config values when no flags provided", () => {
			const config = loadConfig("/tmp/proj");
			const result = resolveCommandConfig(config, "plan");
			expect(result).toEqual({
				cli: "claude",
				model: "default",
				iterations: 2,
			});
		});

		it("--cli flag overrides config cli", () => {
			const config = loadConfig("/tmp/proj");
			const result = resolveCommandConfig(config, "plan", { cli: "codex" });
			expect(result.cli).toBe("codex");
		});

		it("--model flag overrides config model", () => {
			const config = loadConfig("/tmp/proj");
			const result = resolveCommandConfig(config, "build", {
				model: "o3",
			});
			expect(result.model).toBe("o3");
		});

		it("--iterations flag overrides config iterations", () => {
			const config = loadConfig("/tmp/proj");
			const result = resolveCommandConfig(config, "build", {
				iterations: 5,
			});
			expect(result.iterations).toBe(5);
		});

		it("empty string model treated as default", () => {
			mockConfigFile(globalConfigPath, { plan: { model: "" } });
			const config = loadConfig("/tmp/proj");
			const result = resolveCommandConfig(config, "plan");
			expect(result.model).toBe("default");
		});

		it("partial flags only override provided values", () => {
			mockConfigFile(globalConfigPath, {
				plan: { cli: "codex", model: "gpt-4", iterations: 5 },
			});
			const config = loadConfig("/tmp/proj");
			const result = resolveCommandConfig(config, "plan", { cli: "claude" });
			expect(result).toEqual({
				cli: "claude",
				model: "gpt-4",
				iterations: 5,
			});
		});

		it("uses build config for build command", () => {
			const config = loadConfig("/tmp/proj");
			const result = resolveCommandConfig(config, "build");
			expect(result.iterations).toBe(10);
		});
	});
});
