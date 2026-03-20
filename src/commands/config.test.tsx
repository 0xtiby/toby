import React from "react";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render } from "ink-testing-library";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import Config from "./config.js";

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
