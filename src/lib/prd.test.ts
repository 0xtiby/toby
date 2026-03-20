import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { PrdSchema, TaskSchema, TaskStatusSchema } from "../types.js";
import { readPrd, hasPrd, getPrdPath, getTaskSummary } from "./prd.js";

const validTask = {
	id: "task-1",
	title: "First task",
	description: "A task",
	acceptanceCriteria: ["it works"],
	files: ["src/foo.ts"],
	dependencies: [],
	priority: 1,
};

const validPrd = {
	spec: "01-auth",
	createdAt: "2026-01-15T10:00:00Z",
	tasks: [
		validTask,
		{ ...validTask, id: "task-2", title: "Second task", priority: 2 },
	],
};

describe("TaskStatusSchema", () => {
	it("accepts valid statuses", () => {
		for (const s of ["pending", "in_progress", "done", "blocked"]) {
			expect(TaskStatusSchema.parse(s)).toBe(s);
		}
	});

	it("rejects invalid status", () => {
		expect(() => TaskStatusSchema.parse("unknown")).toThrow();
	});
});

describe("TaskSchema", () => {
	it("parses a valid task", () => {
		const result = TaskSchema.parse(validTask);
		expect(result.id).toBe("task-1");
		expect(result.status).toBe("pending");
	});

	it("defaults status to pending", () => {
		const result = TaskSchema.parse(validTask);
		expect(result.status).toBe("pending");
	});

	it("accepts explicit status", () => {
		const result = TaskSchema.parse({ ...validTask, status: "done" });
		expect(result.status).toBe("done");
	});

	it("rejects missing required fields", () => {
		expect(() => TaskSchema.parse({ id: "x" })).toThrow();
	});
});

describe("PrdSchema", () => {
	it("parses a valid PRD", () => {
		const result = PrdSchema.parse(validPrd);
		expect(result.spec).toBe("01-auth");
		expect(result.tasks).toHaveLength(2);
	});

	it("accepts empty tasks array", () => {
		const result = PrdSchema.parse({
			spec: "02-empty",
			createdAt: "2026-01-15T10:00:00Z",
			tasks: [],
		});
		expect(result.tasks).toHaveLength(0);
	});

	it("rejects duplicate task IDs", () => {
		const duplicate = {
			...validPrd,
			tasks: [validTask, { ...validTask, priority: 2 }],
		};
		expect(() => PrdSchema.parse(duplicate)).toThrow("Task IDs must be unique");
	});

	it("rejects invalid createdAt format", () => {
		expect(() =>
			PrdSchema.parse({ ...validPrd, createdAt: "not-a-date" }),
		).toThrow();
	});

	it("rejects missing spec field", () => {
		expect(() =>
			PrdSchema.parse({
				createdAt: "2026-01-15T10:00:00Z",
				tasks: [],
			}),
		).toThrow();
	});
});

describe("PRD read utilities", () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "toby-prd-test-"));
	});

	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	function writePrdFile(specName: string, data: unknown): void {
		const prdDir = path.join(tmpDir, ".toby", "prd");
		fs.mkdirSync(prdDir, { recursive: true });
		fs.writeFileSync(
			path.join(prdDir, `${specName}.json`),
			JSON.stringify(data),
		);
	}

	describe("getPrdPath", () => {
		it("returns .toby/prd/<specName>.json path", () => {
			const result = getPrdPath("01-auth", tmpDir);
			expect(result).toBe(path.join(tmpDir, ".toby", "prd", "01-auth.json"));
		});
	});

	describe("hasPrd", () => {
		it("returns false when file does not exist", () => {
			expect(hasPrd("missing-spec", tmpDir)).toBe(false);
		});

		it("returns true when file exists", () => {
			writePrdFile("01-auth", validPrd);
			expect(hasPrd("01-auth", tmpDir)).toBe(true);
		});
	});

	describe("readPrd", () => {
		it("returns null when file does not exist", () => {
			expect(readPrd("missing-spec", tmpDir)).toBeNull();
		});

		it("returns valid Prd object for valid JSON", () => {
			writePrdFile("01-auth", validPrd);
			const result = readPrd("01-auth", tmpDir);
			expect(result).not.toBeNull();
			expect(result!.spec).toBe("01-auth");
			expect(result!.tasks).toHaveLength(2);
		});

		it("throws on invalid JSON schema with file path in error", () => {
			writePrdFile("bad-spec", { spec: 123 });
			expect(() => readPrd("bad-spec", tmpDir)).toThrow(/Invalid PRD at/);
			expect(() => readPrd("bad-spec", tmpDir)).toThrow(/bad-spec\.json/);
		});
	});

	describe("getTaskSummary", () => {
		it("counts tasks by status with all statuses initialized to 0", () => {
			const prd = PrdSchema.parse({
				spec: "test",
				createdAt: "2026-01-15T10:00:00Z",
				tasks: [
					{ ...validTask, id: "t1", status: "pending" },
					{ ...validTask, id: "t2", status: "pending" },
					{ ...validTask, id: "t3", status: "done", priority: 2 },
				],
			});
			const summary = getTaskSummary(prd);
			expect(summary).toEqual({
				pending: 2,
				in_progress: 0,
				done: 1,
				blocked: 0,
			});
		});

		it("counts all-pending tasks correctly", () => {
			const prd = PrdSchema.parse({
				spec: "test",
				createdAt: "2026-01-15T10:00:00Z",
				tasks: [
					{ ...validTask, id: "t1" },
					{ ...validTask, id: "t2", priority: 2 },
				],
			});
			const summary = getTaskSummary(prd);
			expect(summary).toEqual({
				pending: 2,
				in_progress: 0,
				done: 0,
				blocked: 0,
			});
		});

		it("returns all zeros for empty tasks", () => {
			const prd = PrdSchema.parse({
				spec: "empty",
				createdAt: "2026-01-15T10:00:00Z",
				tasks: [],
			});
			const summary = getTaskSummary(prd);
			expect(summary).toEqual({
				pending: 0,
				in_progress: 0,
				done: 0,
				blocked: 0,
			});
		});
	});
});
