import { describe, it, expect } from "vitest";
import {
	formatGlobalHelp,
	formatCommandHelp,
	formatErrorWithHint,
	commandHelp,
} from "../help.js";

const EXPECTED_COMMANDS = ["plan", "build", "init", "status", "config", "clean"];

function assertMaxLineWidth(output: string, maxWidth = 80) {
	const lines = output.split("\n");
	for (const line of lines) {
		expect(line.length).toBeLessThanOrEqual(maxWidth);
	}
}

describe("commandHelp registry", () => {
	it("has entries for all 6 commands", () => {
		expect(Object.keys(commandHelp).sort()).toEqual(
			[...EXPECTED_COMMANDS].sort(),
		);
	});

	it("each entry has required fields", () => {
		for (const cmd of EXPECTED_COMMANDS) {
			const help = commandHelp[cmd];
			expect(help.summary).toBeTruthy();
			expect(help.usage.length).toBeGreaterThan(0);
			expect(help.examples.length).toBeGreaterThanOrEqual(2);
		}
	});
});

describe("formatGlobalHelp", () => {
	it("includes version", () => {
		const output = formatGlobalHelp("1.2.3");
		expect(output).toContain("toby v1.2.3");
	});

	it("includes all 6 commands", () => {
		const output = formatGlobalHelp("1.0.0");
		for (const cmd of EXPECTED_COMMANDS) {
			expect(output).toContain(cmd);
		}
	});

	it("includes global options", () => {
		const output = formatGlobalHelp("1.0.0");
		expect(output).toContain("--help");
		expect(output).toContain("--version");
	});

	it("includes footer directing to per-command help", () => {
		const output = formatGlobalHelp("1.0.0");
		expect(output).toContain(
			"Run toby <command> --help for command-specific options and examples.",
		);
	});

	it("does NOT include per-command flags", () => {
		const output = formatGlobalHelp("1.0.0");
		expect(output).not.toContain("--spec");
		expect(output).not.toContain("--cli");
		expect(output).not.toContain("--iterations");
	});

	it("all lines fit within 80 columns", () => {
		assertMaxLineWidth(formatGlobalHelp("1.0.0"));
	});
});

describe("formatCommandHelp", () => {
	for (const cmd of EXPECTED_COMMANDS) {
		describe(cmd, () => {
			const help = commandHelp[cmd];
			const output = formatCommandHelp(cmd, help);

			it("includes command name and summary", () => {
				expect(output).toContain(`toby ${cmd} — ${help.summary}`);
			});

			it("includes usage section", () => {
				expect(output).toContain("Usage");
				for (const usage of help.usage) {
					expect(output).toContain(usage);
				}
			});

			it("includes examples section", () => {
				expect(output).toContain("Examples");
				for (const ex of help.examples) {
					expect(output).toContain(ex.command);
					expect(output).toContain(ex.description);
				}
			});

			if (help.flags.length > 0) {
				it("includes options section with all flags", () => {
					expect(output).toContain("Options");
					for (const flag of help.flags) {
						expect(output).toContain(flag.name);
						expect(output).toContain(flag.description);
					}
				});
			} else {
				it("omits options section when no flags", () => {
					expect(output).not.toContain("Options");
				});
			}

			it("all lines fit within 80 columns", () => {
				assertMaxLineWidth(output);
			});
		});
	}
});

describe("formatErrorWithHint", () => {
	it("formats message with ✗ prefix", () => {
		const output = formatErrorWithHint("Something went wrong");
		expect(output).toContain("✗ Something went wrong");
	});

	it("includes valid values when provided", () => {
		const output = formatErrorWithHint("Unknown CLI: gpt", [
			"claude",
			"codex",
			"opencode",
		]);
		expect(output).toContain(
			"✗ Unknown CLI: gpt. Valid options: claude, codex, opencode",
		);
	});

	it("includes example when provided", () => {
		const output = formatErrorWithHint(
			"Unknown CLI: gpt",
			["claude", "codex", "opencode"],
			"toby plan --cli=claude --spec=auth",
		);
		expect(output).toContain("Example:");
		expect(output).toContain("$ toby plan --cli=claude --spec=auth");
	});

	it("works with message only (no optional params)", () => {
		const output = formatErrorWithHint("Unknown command: deploy");
		expect(output).toBe("✗ Unknown command: deploy\n");
		expect(output).not.toContain("Valid options");
		expect(output).not.toContain("Example");
	});

	it("all lines fit within 80 columns", () => {
		assertMaxLineWidth(
			formatErrorWithHint(
				"Unknown CLI: gpt",
				["claude", "codex", "opencode"],
				"toby plan --cli=claude --spec=auth",
			),
		);
	});
});
