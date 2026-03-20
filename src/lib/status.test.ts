import { describe, it, expect } from "vitest";
import {
	IterationSchema,
	SpecStatusEntrySchema,
	StatusSchema,
} from "../types.js";

const validIteration = {
	type: "build" as const,
	iteration: 1,
	sessionId: "sess-abc",
	cli: "claude",
	model: "opus",
	startedAt: "2026-01-15T10:00:00Z",
	completedAt: "2026-01-15T10:05:00Z",
	exitCode: 0,
	taskCompleted: "task-1",
	tokensUsed: 5000,
};

const validEntry = {
	status: "building" as const,
	plannedAt: "2026-01-15T09:00:00Z",
	iterations: [validIteration],
};

const validStatus = {
	specs: {
		"01-auth": validEntry,
	},
};

describe("IterationSchema", () => {
	it("parses a valid iteration", () => {
		const result = IterationSchema.parse(validIteration);
		expect(result.type).toBe("build");
		expect(result.iteration).toBe(1);
	});

	it("accepts nullable fields as null", () => {
		const result = IterationSchema.parse({
			...validIteration,
			sessionId: null,
			completedAt: null,
			exitCode: null,
			taskCompleted: null,
			tokensUsed: null,
		});
		expect(result.sessionId).toBeNull();
		expect(result.completedAt).toBeNull();
		expect(result.exitCode).toBeNull();
		expect(result.taskCompleted).toBeNull();
		expect(result.tokensUsed).toBeNull();
	});

	it("rejects invalid type", () => {
		expect(() =>
			IterationSchema.parse({ ...validIteration, type: "deploy" }),
		).toThrow();
	});

	it("rejects non-positive iteration", () => {
		expect(() =>
			IterationSchema.parse({ ...validIteration, iteration: 0 }),
		).toThrow();
	});
});

describe("SpecStatusEntrySchema", () => {
	it("parses a valid entry", () => {
		const result = SpecStatusEntrySchema.parse(validEntry);
		expect(result.status).toBe("building");
		expect(result.iterations).toHaveLength(1);
	});

	it("accepts all valid status values", () => {
		for (const status of ["pending", "planned", "building", "done"]) {
			const result = SpecStatusEntrySchema.parse({ ...validEntry, status });
			expect(result.status).toBe(status);
		}
	});

	it("accepts null plannedAt", () => {
		const result = SpecStatusEntrySchema.parse({
			...validEntry,
			plannedAt: null,
		});
		expect(result.plannedAt).toBeNull();
	});

	it("rejects invalid status", () => {
		expect(() =>
			SpecStatusEntrySchema.parse({ ...validEntry, status: "unknown" }),
		).toThrow();
	});
});

describe("StatusSchema", () => {
	it("parses a valid status", () => {
		const result = StatusSchema.parse(validStatus);
		expect(result.specs["01-auth"].status).toBe("building");
	});

	it("accepts empty specs record", () => {
		const result = StatusSchema.parse({ specs: {} });
		expect(Object.keys(result.specs)).toHaveLength(0);
	});

	it("accepts multiple spec entries", () => {
		const result = StatusSchema.parse({
			specs: {
				"01-auth": validEntry,
				"02-api": { ...validEntry, status: "done" },
			},
		});
		expect(Object.keys(result.specs)).toHaveLength(2);
	});

	it("rejects missing specs field", () => {
		expect(() => StatusSchema.parse({})).toThrow();
	});

	it("rejects invalid entry in specs", () => {
		expect(() =>
			StatusSchema.parse({ specs: { "01-auth": { status: "bad" } } }),
		).toThrow();
	});
});
