import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

function run(...args: string[]): string {
	try {
		return execFileSync("node", ["dist/cli.js", ...args], {
			encoding: "utf-8",
			env: { ...process.env, NO_COLOR: "1" },
		}).trim();
	} catch (error: any) {
		return (error.stdout ?? "").trim() + (error.stderr ?? "").trim();
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
	it("renders without crashing (no args shows help)", () => {
		const output = run();
		expect(output).toContain("toby");
		expect(output).toContain("Usage");
	});

	it("shows help with all 5 commands", () => {
		const output = run("--help");
		expect(output).toContain("plan");
		expect(output).toContain("build");
		expect(output).toContain("init");
		expect(output).toContain("status");
		expect(output).toContain("config");
	});

	it("shows version", () => {
		const output = run("--version");
		expect(output).toMatch(/\d+\.\d+\.\d+/);
	});

	it("shows error for unknown command", () => {
		const output = run("foobar");
		expect(output).toContain("Unknown command: foobar");
	});

	it("plan without --spec shows spec selector or no-specs message", () => {
		const output = run("plan");
		// In non-TTY/CI, shows either "No specs found" or "Select a spec"
		expect(output).toMatch(/No specs found|Select a spec/);
	});

	it("plan with --spec for nonexistent spec shows error", () => {
		const output = run("plan", "--spec=nonexistent");
		expect(output).toContain("not found");
	});
});
