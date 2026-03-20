import { describe, it, expect } from "vitest";
import { PrdSchema, TaskSchema, TaskStatusSchema } from "../types.js";

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
