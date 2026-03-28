import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { runStatus } from "./status.js";

let tmpDir: string;
let output: string[];

beforeEach(() => {
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "toby-status-test-"));
	vi.spyOn(process, "cwd").mockReturnValue(tmpDir);
	output = [];
	vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
		output.push(args.map(String).join(" "));
	});
});

afterEach(() => {
	vi.restoreAllMocks();
	fs.rmSync(tmpDir, { recursive: true, force: true });
});

function initToby(): void {
	fs.mkdirSync(path.join(tmpDir, ".toby"), { recursive: true });
	fs.writeFileSync(
		path.join(tmpDir, ".toby", "config.json"),
		JSON.stringify({ specsDir: "specs" }),
	);
	fs.writeFileSync(path.join(tmpDir, ".toby", "status.json"), JSON.stringify({ specs: {} }));
}

function addSpec(name: string): void {
	const specsDir = path.join(tmpDir, "specs");
	fs.mkdirSync(specsDir, { recursive: true });
	fs.writeFileSync(path.join(specsDir, `${name}.md`), `# ${name}`);
}

function makeIter(overrides: Record<string, unknown> = {}) {
	return {
		type: "plan",
		iteration: 1,
		sessionId: null,
		state: "complete",
		cli: "claude",
		model: "sonnet",
		startedAt: "2026-01-01T00:00:00Z",
		completedAt: "2026-01-01T00:01:00Z",
		tokensUsed: 1000,
		exitCode: 0,
		taskCompleted: null,
		...overrides,
	};
}

function setStatus(specs: Record<string, unknown>): void {
	fs.writeFileSync(
		path.join(tmpDir, ".toby", "status.json"),
		JSON.stringify({ specs }),
	);
}

describe("runStatus", () => {
	it("shows error when .toby/ doesn't exist", async () => {
		await runStatus({ version: "1.0.0" });
		const text = output.join("\n");
		expect(text).toContain("Toby not initialized");
		expect(text).toContain("toby init");
	});

	it("shows 'No specs found' with 0 specs", async () => {
		initToby();
		await runStatus({ version: "1.0.0" });
		const text = output.join("\n");
		expect(text).toContain("No specs found");
	});

	it("shows overview table with spec data", async () => {
		initToby();
		addSpec("01-auth");
		addSpec("02-database");
		setStatus({
			"01-auth": {
				status: "done",
				plannedAt: null,
				iterations: [makeIter({ tokensUsed: 5000 })],
			},
			"02-database": {
				status: "planned",
				plannedAt: null,
				iterations: [],
			},
		});
		await runStatus({ version: "1.0.0" });
		const text = output.join("\n");
		expect(text).toContain("01-auth");
		expect(text).toContain("02-database");
		expect(text).toContain("5,000");
		expect(text).toContain("Total:");
	});

	it("shows version in overview", async () => {
		initToby();
		await runStatus({ version: "2.5.0" });
		const text = output.join("\n");
		expect(text).toContain("toby v2.5.0");
	});

	it("shows detail view for --spec", async () => {
		initToby();
		addSpec("01-auth");
		setStatus({
			"01-auth": {
				status: "done",
				plannedAt: null,
				iterations: [
					makeIter({ type: "plan", iteration: 1, tokensUsed: 4100 }),
					makeIter({
						type: "build",
						iteration: 2,
						tokensUsed: 5200,
						startedAt: "2026-01-01T00:02:00Z",
						completedAt: "2026-01-01T00:03:12Z",
					}),
				],
			},
		});
		await runStatus({ spec: "01-auth", version: "1.0.0" });
		const text = output.join("\n");
		expect(text).toContain("01-auth");
		expect(text).toContain("plan");
		expect(text).toContain("build");
		expect(text).toContain("4,100");
		expect(text).toContain("Iterations: 2");
	});

	it("shows error for unknown spec", async () => {
		initToby();
		addSpec("01-auth");
		await runStatus({ spec: "99-nonexistent", version: "1.0.0" });
		const text = output.join("\n");
		expect(text).toContain("Spec not found");
	});

	it("warns on corrupt status.json", async () => {
		initToby();
		addSpec("01-auth");
		fs.writeFileSync(path.join(tmpDir, ".toby", "status.json"), "NOT VALID JSON{{{");
		await runStatus({ version: "1.0.0" });
		const text = output.join("\n");
		expect(text).toContain("Corrupt status.json");
	});
});
