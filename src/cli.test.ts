import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

function run(...args: string[]): { stdout: string; stderr: string; exitCode: number } {
	try {
		const stdout = execFileSync("node", ["dist/cli.js", ...args], {
			encoding: "utf-8",
			env: { ...process.env, NO_COLOR: "1" },
		}).trim();
		return { stdout, stderr: "", exitCode: 0 };
	} catch (error: any) {
		return {
			stdout: (error.stdout ?? "").trim(),
			stderr: (error.stderr ?? "").trim(),
			exitCode: error.status ?? 1,
		};
	}
}

describe("package.json", () => {
	const pkg = JSON.parse(readFileSync("package.json", "utf-8"));

	it("has correct package name", () => {
		expect(pkg.name).toBe("@0xtiby/toby");
	});

	it("has bin entry pointing to dist/cli.js", () => {
		expect(pkg.bin.toby).toBe("./dist/cli.js");
	});

	it("includes dist and prompts in files", () => {
		expect(pkg.files).toContain("dist");
		expect(pkg.files).toContain("prompts");
	});
});

describe("cli", () => {
	it("no args shows help", () => {
		const { stdout } = run();
		expect(stdout).toContain("toby");
		expect(stdout).toContain("Commands:");
	});

	it("--help lists all 7 commands", () => {
		const { stdout } = run("--help");
		for (const cmd of ["plan", "build", "resume", "init", "status", "config", "clean"]) {
			expect(stdout).toContain(cmd);
		}
	});

	it("plan --help shows --spec flag", () => {
		const { stdout } = run("plan", "--help");
		expect(stdout).toContain("--spec");
	});

	it("build --help shows --session flag", () => {
		const { stdout } = run("build", "--help");
		expect(stdout).toContain("--session");
	});

	it("init --help shows --plan-cli flag", () => {
		const { stdout } = run("init", "--help");
		expect(stdout).toContain("--plan-cli");
	});

	it("config --help shows subcommand argument", () => {
		const { stdout } = run("config", "--help");
		expect(stdout).toContain("subcommand");
	});

	it("clean --help shows --force flag", () => {
		const { stdout } = run("clean", "--help");
		expect(stdout).toContain("--force");
	});

	it("status --help shows --spec flag", () => {
		const { stdout } = run("status", "--help");
		expect(stdout).toContain("--spec");
	});

	it("resume --help shows --iterations flag", () => {
		const { stdout } = run("resume", "--help");
		expect(stdout).toContain("--iterations");
	});

	it("--version shows version", () => {
		const { stdout } = run("--version");
		expect(stdout).toMatch(/\d+\.\d+\.\d+/);
	});

	it("unknown command exits with error", () => {
		const { stderr, exitCode } = run("foobar");
		expect(exitCode).toBe(1);
		expect(stderr).toContain("unknown command");
	});

	it("--help includes help command guidance", () => {
		const { stdout } = run("--help");
		expect(stdout).toContain("help [command]");
	});

	it("unknown command with typo suggests correct command", () => {
		const { stderr } = run("plna");
		expect(stderr).toContain("Did you mean plan");
	});

	// plan --spec=nonexistent test deferred to spec 53 (plan-command-migration)
	// because plan.tsx still imports deleted React hooks, causing module load errors
});
