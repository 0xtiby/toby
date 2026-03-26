import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";

interface RunResult {
	stdout: string;
	stderr: string;
	exitCode: number;
}

function run(...args: string[]): RunResult {
	try {
		const stdout = execFileSync("node", ["dist/cli.js", ...args], {
			encoding: "utf-8",
			env: { ...process.env, NO_COLOR: "1" },
		});
		return { stdout, stderr: "", exitCode: 0 };
	} catch (error: any) {
		return {
			stdout: error.stdout ?? "",
			stderr: error.stderr ?? "",
			exitCode: error.status ?? 1,
		};
	}
}

describe("help integration", () => {
	describe("global help", () => {
		it("--help exits 0 and shows global help", () => {
			const result = run("--help");
			expect(result.exitCode).toBe(0);
			expect(result.stdout).toContain("Commands");
			expect(result.stdout).toContain("toby v");
		});

		it("no args in non-TTY exits 0 and shows global help", () => {
			const result = run();
			expect(result.exitCode).toBe(0);
			expect(result.stdout).toContain("Commands");
		});
	});

	describe("per-command help", () => {
		const commands = ["plan", "build", "init", "status", "config", "clean"];

		for (const cmd of commands) {
			it(`${cmd} --help exits 0 and shows examples`, () => {
				const result = run(cmd, "--help");
				expect(result.exitCode).toBe(0);
				expect(result.stdout).toContain("Examples");
				expect(result.stdout).toContain(`toby ${cmd}`);
			});
		}
	});

	describe("help precedence", () => {
		it("--help takes precedence over --spec flag", () => {
			const result = run("plan", "--help", "--spec=auth");
			expect(result.exitCode).toBe(0);
			expect(result.stdout).toContain("Examples");
			// Should NOT contain plan execution output
			expect(result.stdout).not.toContain("not found");
		});

		it("--help takes precedence over --version", () => {
			const result = run("--help", "--version");
			expect(result.exitCode).toBe(0);
			expect(result.stdout).toContain("Commands");
		});
	});

	describe("error hints", () => {
		it("unknown command exits 1 with valid options and example", () => {
			const result = run("deploy");
			expect(result.exitCode).toBe(1);
			expect(result.stderr).toContain("Unknown command: deploy");
			expect(result.stderr).toContain("Valid options:");
			expect(result.stderr).toContain("$ toby --help");
		});

		it("unknown command with --help also exits 1", () => {
			const result = run("deploy", "--help");
			expect(result.exitCode).toBe(1);
			expect(result.stderr).toContain("Unknown command: deploy");
		});
	});
});
