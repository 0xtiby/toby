import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { computeProjectStats } from "../stats.js";

describe("computeProjectStats", () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "toby-stats-test-"));
	});

	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	function writeSpecFile(filename: string, content = "# Spec") {
		const specsDir = path.join(tmpDir, "specs");
		fs.mkdirSync(specsDir, { recursive: true });
		fs.writeFileSync(path.join(specsDir, filename), content);
	}

	function writeStatusJson(
		specs: Record<
			string,
			{
				status: string;
				iterations?: Array<{
					type: string;
					iteration: number;
					sessionId: string;
					cli: string;
					model: string;
					startedAt: string;
					completedAt: string | null;
					exitCode: number | null;
					taskCompleted: string | null;
					tokensUsed: number | null;
				}>;
			}
		>,
	) {
		const tobyDir = path.join(tmpDir, ".toby");
		fs.mkdirSync(tobyDir, { recursive: true });
		fs.writeFileSync(
			path.join(tobyDir, "status.json"),
			JSON.stringify({
				specs: Object.fromEntries(
					Object.entries(specs).map(([name, entry]) => [
						name,
						{
							status: entry.status,
							plannedAt: null,
							iterations: entry.iterations ?? [],
						},
					]),
				),
			}),
		);
	}

	function makeIteration(overrides: Record<string, unknown> = {}) {
		return {
			type: "build",
			iteration: 1,
			sessionId: "sess-1",
			cli: "claude",
			model: "opus",
			startedAt: "2026-01-15T10:00:00Z",
			completedAt: "2026-01-15T10:05:00Z",
			exitCode: 0,
			taskCompleted: "task-1",
			tokensUsed: 5000,
			...overrides,
		};
	}

	it("returns null when .toby/ dir does not exist", () => {
		expect(computeProjectStats(tmpDir)).toBeNull();
	});

	it("returns all zeros when status.json is empty and no specs found", () => {
		writeStatusJson({});
		const stats = computeProjectStats(tmpDir);
		expect(stats).toEqual({
			totalSpecs: 0,
			pending: 0,
			planned: 0,
			building: 0,
			done: 0,
			totalIterations: 0,
			totalTokens: 0,
			totalInputTokens: 0,
			totalOutputTokens: 0,
			totalCost: 0,
		});
	});

	it("counts specs by status bucket correctly", () => {
		writeSpecFile("01-auth.md");
		writeSpecFile("02-payments.md");
		writeSpecFile("03-notifications.md");
		writeSpecFile("04-search.md");
		writeSpecFile("05-analytics.md");
		writeStatusJson({
			"01-auth": {
				status: "done",
				iterations: [makeIteration(), makeIteration({ iteration: 2 })],
			},
			"02-payments": {
				status: "building",
				iterations: [makeIteration()],
			},
			"03-notifications": { status: "planned" },
			"04-search": { status: "planned" },
			"05-analytics": { status: "planned" },
		});

		const stats = computeProjectStats(tmpDir);
		expect(stats).toEqual({
			totalSpecs: 5,
			pending: 0,
			planned: 3,
			building: 1,
			done: 1,
			totalIterations: 3,
			totalTokens: 15000,
			totalInputTokens: 0,
			totalOutputTokens: 0,
			totalCost: 0,
		});
	});

	it("returns null when status.json contains corrupted JSON", () => {
		const tobyDir = path.join(tmpDir, ".toby");
		fs.mkdirSync(tobyDir, { recursive: true });
		fs.writeFileSync(path.join(tobyDir, "status.json"), "NOT VALID JSON{{{");

		expect(computeProjectStats(tmpDir)).toBeNull();
	});

	it("counts iterations from deleted specs but excludes them from totalSpecs", () => {
		writeSpecFile("01-auth.md");
		writeStatusJson({
			"01-auth": {
				status: "done",
				iterations: [makeIteration()],
			},
			"deleted-spec": {
				status: "done",
				iterations: [
					makeIteration(),
					makeIteration({ iteration: 2 }),
					makeIteration({ iteration: 3 }),
				],
			},
		});

		const stats = computeProjectStats(tmpDir);
		expect(stats).not.toBeNull();
		expect(stats!.totalSpecs).toBe(1);
		expect(stats!.totalIterations).toBe(4);
		expect(stats!.totalTokens).toBe(20000);
	});

	it("returns totalSpecs 0 with iterations when .toby/ exists but no specs dir", () => {
		writeStatusJson({
			"old-spec": {
				status: "done",
				iterations: [makeIteration(), makeIteration({ iteration: 2 })],
			},
		});

		const stats = computeProjectStats(tmpDir);
		expect(stats).not.toBeNull();
		expect(stats!.totalSpecs).toBe(0);
		expect(stats!.totalIterations).toBe(2);
		expect(stats!.totalTokens).toBe(10000);
	});

	it("sums totalTokens treating null tokensUsed as 0", () => {
		writeSpecFile("01-auth.md");
		writeStatusJson({
			"01-auth": {
				status: "done",
				iterations: [
					makeIteration({ tokensUsed: 100 }),
					makeIteration({ iteration: 2, tokensUsed: null }),
					makeIteration({ iteration: 3, tokensUsed: 250 }),
				],
			},
		});

		const stats = computeProjectStats(tmpDir);
		expect(stats).not.toBeNull();
		expect(stats!.totalTokens).toBe(350);
	});

	it("returns totalTokens 0 when no iterations exist", () => {
		writeSpecFile("01-auth.md");
		writeStatusJson({
			"01-auth": { status: "planned" },
		});

		const stats = computeProjectStats(tmpDir);
		expect(stats).not.toBeNull();
		expect(stats!.totalTokens).toBe(0);
	});

	it("defaults undiscovered spec statuses to pending", () => {
		writeSpecFile("01-auth.md");
		writeSpecFile("02-payments.md");
		writeStatusJson({});

		const stats = computeProjectStats(tmpDir);
		expect(stats).toEqual({
			totalSpecs: 2,
			pending: 2,
			planned: 0,
			building: 0,
			done: 0,
			totalIterations: 0,
			totalTokens: 0,
			totalInputTokens: 0,
			totalOutputTokens: 0,
			totalCost: 0,
		});
	});
});
