import React from "react";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render } from "ink-testing-library";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import Config, { ConfigSetBatch } from "./config.js";

describe("Config", () => {
	let tmpDir: string;
	let originalCwd: string;

	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "toby-config-test-"));
		originalCwd = process.cwd();
		process.chdir(tmpDir);

		// Create .toby dir with a local config
		fs.mkdirSync(path.join(tmpDir, ".toby"), { recursive: true });
	});

	afterEach(() => {
		process.chdir(originalCwd);
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	it("shows usage without subcommand", () => {
		const { lastFrame } = render(<Config version="0.1.0" />);
		expect(lastFrame()).toContain("toby config");
		expect(lastFrame()).toContain("Available keys");
	});

	it("shows error for unknown subcommand", () => {
		const { lastFrame } = render(
			<Config version="0.1.0" subcommand="badcmd" />,
		);
		expect(lastFrame()).toContain("Unknown config subcommand: badcmd");
	});

	it("get returns resolved value for nested key", () => {
		const { lastFrame } = render(
			<Config version="0.1.0" subcommand="get" configKey="plan.cli" />,
		);
		expect(lastFrame()).toContain("claude");
	});

	it("get returns correct value for top-level key", () => {
		const { lastFrame } = render(
			<Config version="0.1.0" subcommand="get" configKey="specsDir" />,
		);
		expect(lastFrame()).toContain("specs");
	});

	it("get returns numeric value", () => {
		const { lastFrame } = render(
			<Config version="0.1.0" subcommand="get" configKey="build.iterations" />,
		);
		expect(lastFrame()).toContain("10");
	});

	it("get shows error for unknown key", () => {
		const { lastFrame } = render(
			<Config version="0.1.0" subcommand="get" configKey="nonexistent" />,
		);
		expect(lastFrame()).toContain("Unknown config key: nonexistent");
	});

	it("set updates local config", () => {
		const { lastFrame } = render(
			<Config
				version="0.1.0"
				subcommand="set"
				configKey="build.iterations"
				value="20"
			/>,
		);
		expect(lastFrame()).toContain("Set build.iterations = 20");

		// Verify file was written
		const configPath = path.join(tmpDir, ".toby", "config.json");
		const written = JSON.parse(fs.readFileSync(configPath, "utf-8"));
		expect(written.build.iterations).toBe(20);
	});

	it("set creates config file when missing", () => {
		const configPath = path.join(tmpDir, ".toby", "config.json");
		// Ensure no config exists
		if (fs.existsSync(configPath)) fs.unlinkSync(configPath);

		const { lastFrame } = render(
			<Config
				version="0.1.0"
				subcommand="set"
				configKey="verbose"
				value="true"
			/>,
		);
		expect(lastFrame()).toContain("Set verbose = true");
		expect(fs.existsSync(configPath)).toBe(true);
	});

	it("set rejects invalid values with error", () => {
		const { lastFrame } = render(
			<Config
				version="0.1.0"
				subcommand="set"
				configKey="build.iterations"
				value="notanumber"
			/>,
		);
		expect(lastFrame()).toContain("Invalid value");
	});

	it("set shows error for unknown key", () => {
		const { lastFrame } = render(
			<Config
				version="0.1.0"
				subcommand="set"
				configKey="fake.key"
				value="something"
			/>,
		);
		expect(lastFrame()).toContain("Unknown config key: fake.key");
	});

	it("set shows error when value is missing", () => {
		const { lastFrame } = render(
			<Config version="0.1.0" subcommand="set" configKey="specsDir" />,
		);
		expect(lastFrame()).toContain("Missing value");
	});
});

describe("ConfigSetBatch", () => {
	let tmpDir: string;
	let originalCwd: string;

	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "toby-batch-test-"));
		originalCwd = process.cwd();
		process.chdir(tmpDir);
		fs.mkdirSync(path.join(tmpDir, ".toby"), { recursive: true });
	});

	afterEach(() => {
		process.chdir(originalCwd);
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	it("parses and writes a single key=value pair", () => {
		const { lastFrame } = render(<ConfigSetBatch pairs={["plan.cli=claude"]} />);
		expect(lastFrame()).toContain("Set plan.cli = claude");

		const configPath = path.join(tmpDir, ".toby", "config.json");
		const written = JSON.parse(fs.readFileSync(configPath, "utf-8"));
		expect(written.plan.cli).toBe("claude");
	});

	it("parses and writes multiple key=value pairs", () => {
		const { lastFrame } = render(
			<ConfigSetBatch pairs={["plan.cli=claude", "build.iterations=5"]} />,
		);
		expect(lastFrame()).toContain("Set plan.cli = claude");
		expect(lastFrame()).toContain("Set build.iterations = 5");

		const configPath = path.join(tmpDir, ".toby", "config.json");
		const written = JSON.parse(fs.readFileSync(configPath, "utf-8"));
		expect(written.plan.cli).toBe("claude");
		expect(written.build.iterations).toBe(5);
	});

	it("rejects unknown key with error", () => {
		const { lastFrame } = render(
			<ConfigSetBatch pairs={["invalid.key=value"]} />,
		);
		expect(lastFrame()).toContain("Unknown config key: invalid.key");
	});

	it("rejects invalid value type with error", () => {
		const { lastFrame } = render(
			<ConfigSetBatch pairs={["build.iterations=abc"]} />,
		);
		expect(lastFrame()).toContain("Invalid value for build.iterations");
	});

	it("is atomic: one bad pair means nothing written", () => {
		const { lastFrame } = render(
			<ConfigSetBatch pairs={["plan.cli=claude", "build.iterations=abc"]} />,
		);
		expect(lastFrame()).toContain("Invalid value for build.iterations");

		const configPath = path.join(tmpDir, ".toby", "config.json");
		expect(fs.existsSync(configPath)).toBe(false);
	});

	it("writes all valid pairs in a single writeConfig call", () => {
		const { lastFrame } = render(
			<ConfigSetBatch pairs={["plan.cli=codex", "verbose=true", "specsDir=my-specs"]} />,
		);
		expect(lastFrame()).toContain("Set plan.cli = codex");
		expect(lastFrame()).toContain("Set verbose = true");
		expect(lastFrame()).toContain("Set specsDir = my-specs");

		const configPath = path.join(tmpDir, ".toby", "config.json");
		const written = JSON.parse(fs.readFileSync(configPath, "utf-8"));
		expect(written.plan.cli).toBe("codex");
		expect(written.verbose).toBe(true);
		expect(written.specsDir).toBe("my-specs");
	});

	it("legacy 'config set key value' still works", () => {
		const { lastFrame } = render(
			<Config
				version="0.1.0"
				subcommand="set"
				configKey="plan.cli"
				value="claude"
			/>,
		);
		expect(lastFrame()).toContain("Set plan.cli = claude");

		const configPath = path.join(tmpDir, ".toby", "config.json");
		const written = JSON.parse(fs.readFileSync(configPath, "utf-8"));
		expect(written.plan.cli).toBe("claude");
	});
});
