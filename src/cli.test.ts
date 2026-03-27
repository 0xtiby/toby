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
		expect(stdout).toContain("Usage");
	});

	it("--help shows plan command", () => {
		const { stdout } = run("--help");
		expect(stdout).toContain("plan");
	});

	it("plan --help shows --spec flag", () => {
		const { stdout } = run("plan", "--help");
		expect(stdout).toContain("--spec");
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
});
