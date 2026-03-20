import { describe, it, expect } from "vitest";
import { configToEditorValues, editorValuesToConfig } from "./config.js";
import type { TobyConfig } from "../types.js";

describe("configToEditorValues", () => {
	it("extracts all config fields into flat editor values", () => {
		const config: TobyConfig = {
			plan: { cli: "codex", model: "gpt-4", iterations: 3 },
			build: { cli: "opencode", model: "default", iterations: 5 },
			specsDir: "docs",
			excludeSpecs: ["README.md"],
			verbose: true,
		};

		const values = configToEditorValues(config);

		expect(values).toEqual({
			planCli: "codex",
			planModel: "gpt-4",
			planIterations: 3,
			buildCli: "opencode",
			buildModel: "default",
			buildIterations: 5,
			specsDir: "docs",
			verbose: true,
		});
	});

	it("handles default config values", () => {
		const config: TobyConfig = {
			plan: { cli: "claude", model: "default", iterations: 2 },
			build: { cli: "claude", model: "default", iterations: 10 },
			specsDir: "specs",
			excludeSpecs: ["README.md"],
			verbose: false,
		};

		const values = configToEditorValues(config);

		expect(values.planCli).toBe("claude");
		expect(values.planIterations).toBe(2);
		expect(values.buildIterations).toBe(10);
		expect(values.verbose).toBe(false);
	});
});

describe("editorValuesToConfig", () => {
	it("converts editor values to a partial config for saving", () => {
		const values = {
			planCli: "codex" as const,
			planModel: "gpt-4",
			planIterations: 3,
			buildCli: "opencode" as const,
			buildModel: "default",
			buildIterations: 5,
			specsDir: "docs",
			verbose: true,
		};

		const config = editorValuesToConfig(values);

		expect(config).toEqual({
			plan: { cli: "codex", model: "gpt-4", iterations: 3 },
			build: { cli: "opencode", model: "default", iterations: 5 },
			specsDir: "docs",
			verbose: true,
		});
	});

	it("round-trips through configToEditorValues", () => {
		const original: TobyConfig = {
			plan: { cli: "claude", model: "opus", iterations: 1 },
			build: { cli: "codex", model: "gpt-4", iterations: 8 },
			specsDir: "specifications",
			excludeSpecs: ["README.md"],
			verbose: false,
		};

		const values = configToEditorValues(original);
		const result = editorValuesToConfig(values);

		expect(result.plan).toEqual(original.plan);
		expect(result.build).toEqual(original.build);
		expect(result.specsDir).toBe(original.specsDir);
		expect(result.verbose).toBe(original.verbose);
	});
});
