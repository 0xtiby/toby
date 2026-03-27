import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
	configGet,
	configSet,
	configSetBatch,
	configListAll,
	runConfig,
	getNestedValue,
	setNestedValue,
	parseValue,
	VALID_KEYS,
} from "./config.js";

describe("helper functions", () => {
	describe("getNestedValue", () => {
		it("reads top-level key", () => {
			expect(getNestedValue({ foo: "bar" }, "foo")).toBe("bar");
		});

		it("reads nested key", () => {
			expect(getNestedValue({ a: { b: "c" } }, "a.b")).toBe("c");
		});

		it("returns undefined for missing key", () => {
			expect(getNestedValue({}, "a.b")).toBeUndefined();
		});
	});

	describe("setNestedValue", () => {
		it("sets top-level key", () => {
			const obj: Record<string, unknown> = {};
			setNestedValue(obj, "foo", "bar");
			expect(obj.foo).toBe("bar");
		});

		it("sets nested key, creating intermediates", () => {
			const obj: Record<string, unknown> = {};
			setNestedValue(obj, "a.b", "c");
			expect((obj.a as Record<string, unknown>).b).toBe("c");
		});
	});

	describe("parseValue", () => {
		it("parses number", () => {
			expect(parseValue("42", "number")).toBe(42);
		});

		it("throws on invalid number", () => {
			expect(() => parseValue("abc", "number")).toThrow("Expected a number");
		});

		it("parses boolean true", () => {
			expect(parseValue("true", "boolean")).toBe(true);
		});

		it("parses boolean false", () => {
			expect(parseValue("false", "boolean")).toBe(false);
		});

		it("throws on invalid boolean", () => {
			expect(() => parseValue("yes", "boolean")).toThrow("Expected true or false");
		});

		it("returns string as-is", () => {
			expect(parseValue("hello", "string")).toBe("hello");
		});
	});
});

describe("config commands", () => {
	let tmpDir: string;
	let originalCwd: string;
	let logSpy: ReturnType<typeof vi.spyOn>;
	let errorSpy: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "toby-config-test-"));
		originalCwd = process.cwd();
		process.chdir(tmpDir);
		fs.mkdirSync(path.join(tmpDir, ".toby"), { recursive: true });
		process.exitCode = undefined;
		logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
	});

	afterEach(() => {
		process.chdir(originalCwd);
		fs.rmSync(tmpDir, { recursive: true, force: true });
		process.exitCode = undefined;
		logSpy.mockRestore();
		errorSpy.mockRestore();
	});

	describe("configGet", () => {
		it("prints value for nested key", () => {
			configGet("plan.cli");
			expect(logSpy).toHaveBeenCalledWith("claude");
		});

		it("prints value for top-level key", () => {
			configGet("specsDir");
			expect(logSpy).toHaveBeenCalledWith("specs");
		});

		it("prints numeric value", () => {
			configGet("build.iterations");
			expect(logSpy).toHaveBeenCalledWith("10");
		});

		it("prints error for unknown key", () => {
			configGet("nonexistent");
			expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("Unknown config key: nonexistent"));
			expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("Valid keys:"));
			expect(process.exitCode).toBe(1);
		});
	});

	describe("configListAll", () => {
		it("prints all keys with current values", () => {
			configListAll();
			expect(logSpy).toHaveBeenCalledWith("plan.cli = claude");
			expect(logSpy).toHaveBeenCalledWith("plan.iterations = 2");
			expect(logSpy).toHaveBeenCalledWith("build.iterations = 10");
			expect(logSpy).toHaveBeenCalledWith("specsDir = specs");
			expect(logSpy).toHaveBeenCalledWith("verbose = false");
			expect(logSpy).toHaveBeenCalledWith("transcript = false");
			expect(logSpy.mock.calls.length).toBe(Object.keys(VALID_KEYS).length);
		});
	});

	describe("configSet", () => {
		it("writes value and prints confirmation", () => {
			configSet("build.iterations", "20");
			expect(logSpy).toHaveBeenCalledWith("Set build.iterations = 20");

			const configPath = path.join(tmpDir, ".toby", "config.json");
			const written = JSON.parse(fs.readFileSync(configPath, "utf-8"));
			expect(written.build.iterations).toBe(20);
		});

		it("creates config file when missing", () => {
			const configPath = path.join(tmpDir, ".toby", "config.json");
			if (fs.existsSync(configPath)) fs.unlinkSync(configPath);

			configSet("verbose", "true");
			expect(logSpy).toHaveBeenCalledWith("Set verbose = true");
			expect(fs.existsSync(configPath)).toBe(true);
		});

		it("rejects invalid type", () => {
			configSet("build.iterations", "notanumber");
			expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("Invalid value for build.iterations"));
			expect(process.exitCode).toBe(1);
		});

		it("rejects unknown key", () => {
			configSet("fake.key", "something");
			expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("Unknown config key: fake.key"));
			expect(process.exitCode).toBe(1);
		});

		it("sets transcript true as boolean", () => {
			configSet("transcript", "true");
			expect(logSpy).toHaveBeenCalledWith("Set transcript = true");

			const configPath = path.join(tmpDir, ".toby", "config.json");
			const written = JSON.parse(fs.readFileSync(configPath, "utf-8"));
			expect(written.transcript).toBe(true);
		});

		it("sets transcript false as boolean", () => {
			configSet("transcript", "false");
			expect(logSpy).toHaveBeenCalledWith("Set transcript = false");

			const configPath = path.join(tmpDir, ".toby", "config.json");
			const written = JSON.parse(fs.readFileSync(configPath, "utf-8"));
			expect(written.transcript).toBe(false);
		});

		it("rejects invalid CLI value via schema validation", () => {
			configSet("plan.cli", "invalid");
			expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("Validation error for plan.cli"));
			expect(process.exitCode).toBe(1);
		});
	});

	describe("configSetBatch", () => {
		it("writes a single key=value pair", () => {
			configSetBatch(["plan.cli=claude"]);
			expect(logSpy).toHaveBeenCalledWith("Set plan.cli = claude");

			const configPath = path.join(tmpDir, ".toby", "config.json");
			const written = JSON.parse(fs.readFileSync(configPath, "utf-8"));
			expect(written.plan.cli).toBe("claude");
		});

		it("writes multiple pairs", () => {
			configSetBatch(["plan.cli=codex", "verbose=true", "specsDir=my-specs"]);
			expect(logSpy).toHaveBeenCalledWith("Set plan.cli = codex");
			expect(logSpy).toHaveBeenCalledWith("Set verbose = true");
			expect(logSpy).toHaveBeenCalledWith("Set specsDir = my-specs");

			const configPath = path.join(tmpDir, ".toby", "config.json");
			const written = JSON.parse(fs.readFileSync(configPath, "utf-8"));
			expect(written.plan.cli).toBe("codex");
			expect(written.verbose).toBe(true);
			expect(written.specsDir).toBe("my-specs");
		});

		it("rejects unknown key", () => {
			configSetBatch(["invalid.key=value"]);
			expect(errorSpy).toHaveBeenCalledWith("Unknown config key: invalid.key");
			expect(process.exitCode).toBe(1);
		});

		it("rejects invalid value type", () => {
			configSetBatch(["build.iterations=abc"]);
			expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("Invalid value for build.iterations"));
			expect(process.exitCode).toBe(1);
		});

		it("is atomic: one bad pair means nothing written", () => {
			configSetBatch(["plan.cli=claude", "build.iterations=abc"]);
			expect(process.exitCode).toBe(1);

			const configPath = path.join(tmpDir, ".toby", "config.json");
			expect(fs.existsSync(configPath)).toBe(false);
		});
	});

	describe("runConfig", () => {
		it("routes get with key to configGet", async () => {
			await runConfig(["get", "plan.cli"]);
			expect(logSpy).toHaveBeenCalledWith("claude");
		});

		it("routes get without key to configListAll", async () => {
			await runConfig(["get"]);
			expect(logSpy).toHaveBeenCalledWith("plan.cli = claude");
		});

		it("routes set with key=value to configSetBatch", async () => {
			await runConfig(["set", "plan.cli=codex"]);
			expect(logSpy).toHaveBeenCalledWith("Set plan.cli = codex");
		});

		it("routes set with key value to configSet", async () => {
			await runConfig(["set", "build.iterations", "20"]);
			expect(logSpy).toHaveBeenCalledWith("Set build.iterations = 20");
		});

		it("errors on missing set value", async () => {
			await runConfig(["set", "specsDir"]);
			expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("Missing value"));
			expect(process.exitCode).toBe(1);
		});

		it("errors on unknown subcommand", async () => {
			await runConfig(["badcmd"]);
			expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("Unknown config subcommand: badcmd"));
			expect(process.exitCode).toBe(1);
		});

		it("errors in non-TTY with no subcommand", async () => {
			const origTTY = process.stdout.isTTY;
			Object.defineProperty(process.stdout, "isTTY", { value: false, writable: true, configurable: true });
			try {
				await runConfig([]);
				expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("requires a TTY"));
				expect(process.exitCode).toBe(1);
			} finally {
				Object.defineProperty(process.stdout, "isTTY", { value: origTTY, writable: true, configurable: true });
			}
		});
	});
});
