import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
	IterationSchema,
	IterationStateSchema,
	SpecStatusEntrySchema,
	StopReasonSchema,
	StatusSchema,
	SessionSchema,
	SessionStateSchema,
} from "../types.js";
import type { StatusData } from "../types.js";
import {
	readStatus,
	writeStatus,
	getSpecStatus,
	addIteration,
	updateSpecStatus,
	createSession,
	updateSessionState,
	clearSession,
	hasResumableSession,
} from "./status.js";

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

	it("defaults state to in_progress when omitted", () => {
		const result = IterationSchema.parse(validIteration);
		expect(result.state).toBe("in_progress");
	});

	it("accepts explicit state field", () => {
		for (const state of ["in_progress", "complete", "failed"]) {
			const result = IterationSchema.parse({ ...validIteration, state });
			expect(result.state).toBe(state);
		}
	});

	it("rejects invalid state value", () => {
		expect(() =>
			IterationSchema.parse({ ...validIteration, state: "running" }),
		).toThrow();
	});
});

describe("IterationStateSchema", () => {
	it("validates all three values", () => {
		for (const state of ["in_progress", "complete", "failed"]) {
			expect(IterationStateSchema.parse(state)).toBe(state);
		}
	});

	it("rejects invalid values", () => {
		expect(() => IterationStateSchema.parse("unknown")).toThrow();
	});
});

describe("StopReasonSchema", () => {
	it("validates all four values", () => {
		for (const reason of ["sentinel", "max_iterations", "error", "aborted"]) {
			expect(StopReasonSchema.parse(reason)).toBe(reason);
		}
	});

	it("rejects invalid values", () => {
		expect(() => StopReasonSchema.parse("timeout")).toThrow();
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

	it("accepts stopReason field", () => {
		for (const stopReason of [
			"sentinel",
			"max_iterations",
			"error",
			"aborted",
		]) {
			const result = SpecStatusEntrySchema.parse({
				...validEntry,
				stopReason,
			});
			expect(result.stopReason).toBe(stopReason);
		}
	});

	it("accepts explicit stopReason value", () => {
		const result = SpecStatusEntrySchema.parse({
			...validEntry,
			stopReason: "sentinel",
		});
		expect(result.stopReason).toBe("sentinel");
	});

	it("defaults stopReason to undefined when omitted", () => {
		const result = SpecStatusEntrySchema.parse(validEntry);
		expect(result.stopReason).toBeUndefined();
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

	it("accepts session object", () => {
		const result = StatusSchema.parse({
			...validStatus,
			session: {
				name: "warm-lynx-52",
				cli: "claude",
				specs: ["01-auth"],
				state: "active",
				startedAt: "2026-03-20T00:00:00.000Z",
			},
		});
		expect(result.session?.name).toBe("warm-lynx-52");
		expect(result.session?.cli).toBe("claude");
		expect(result.session?.specs).toEqual(["01-auth"]);
		expect(result.session?.state).toBe("active");
	});

	it("defaults session to undefined when omitted", () => {
		const result = StatusSchema.parse(validStatus);
		expect(result.session).toBeUndefined();
	});

	it("strips old sessionName and lastCli fields (backwards compat)", () => {
		const result = StatusSchema.parse({
			...validStatus,
			sessionName: "warm-lynx-52",
			lastCli: "claude",
		});
		expect(result).not.toHaveProperty("sessionName");
		expect(result).not.toHaveProperty("lastCli");
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

// ── Status utility function tests ───────────────────────────────

describe("readStatus", () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "toby-status-"));
	});

	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	it("returns default for missing file", () => {
		const result = readStatus(tmpDir);
		expect(result).toEqual({ specs: {} });
	});

	it("returns parsed Status for valid file", () => {
		const statusDir = path.join(tmpDir, ".toby");
		fs.mkdirSync(statusDir, { recursive: true });
		fs.writeFileSync(
			path.join(statusDir, "status.json"),
			JSON.stringify(validStatus, null, 2),
		);

		const result = readStatus(tmpDir);
		expect(result.specs["01-auth"].status).toBe("building");
		expect(result.specs["01-auth"].iterations).toHaveLength(1);
	});

	it("throws for corrupted file with file path in error message", () => {
		const statusDir = path.join(tmpDir, ".toby");
		fs.mkdirSync(statusDir, { recursive: true });
		const filePath = path.join(statusDir, "status.json");
		fs.writeFileSync(filePath, "not json {{{");

		expect(() => readStatus(tmpDir)).toThrow(filePath);
	});

	it("throws for invalid schema with file path in error message", () => {
		const statusDir = path.join(tmpDir, ".toby");
		fs.mkdirSync(statusDir, { recursive: true });
		const filePath = path.join(statusDir, "status.json");
		fs.writeFileSync(filePath, JSON.stringify({ wrong: true }));

		expect(() => readStatus(tmpDir)).toThrow(filePath);
	});
});

describe("writeStatus", () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "toby-status-"));
	});

	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	it("creates .toby directory if it doesn't exist", () => {
		writeStatus({ specs: {} }, tmpDir);
		expect(fs.existsSync(path.join(tmpDir, ".toby", "status.json"))).toBe(
			true,
		);
	});

	it("round-trips with readStatus", () => {
		writeStatus(validStatus, tmpDir);
		const result = readStatus(tmpDir);
		expect(result.specs["01-auth"].status).toBe("building");
		expect(result.specs["01-auth"].iterations[0].type).toBe("build");
	});

	it("round-trips session object", () => {
		const statusWithSession = {
			...validStatus,
			session: {
				name: "warm-lynx-52",
				cli: "claude",
				specs: ["01-auth", "02-api"],
				state: "active" as const,
				startedAt: "2026-03-20T00:00:00.000Z",
			},
		};
		writeStatus(statusWithSession, tmpDir);
		const result = readStatus(tmpDir);
		expect(result.session?.name).toBe("warm-lynx-52");
		expect(result.session?.cli).toBe("claude");
		expect(result.session?.specs).toEqual(["01-auth", "02-api"]);
		expect(result.session?.state).toBe("active");
	});

	it("round-trips stopReason on spec entry", () => {
		const statusWithStopReason = {
			specs: {
				"01-auth": { ...validEntry, stopReason: "max_iterations" as const },
			},
		};
		writeStatus(statusWithStopReason, tmpDir);
		const result = readStatus(tmpDir);
		expect(result.specs["01-auth"].stopReason).toBe("max_iterations");
	});

	it("round-trips iteration state field", () => {
		const iterationWithState = {
			...validIteration,
			state: "complete" as const,
		};
		const statusWithState = {
			specs: {
				"01-auth": {
					...validEntry,
					iterations: [iterationWithState],
				},
			},
		};
		writeStatus(statusWithState, tmpDir);
		const result = readStatus(tmpDir);
		expect(result.specs["01-auth"].iterations[0].state).toBe("complete");
	});

	it("writes pretty-printed JSON", () => {
		writeStatus(validStatus, tmpDir);
		const raw = fs.readFileSync(
			path.join(tmpDir, ".toby", "status.json"),
			"utf-8",
		);
		expect(raw).toContain("\n");
		expect(raw.endsWith("\n")).toBe(true);
	});
});

describe("getSpecStatus", () => {
	it("returns existing entry for known spec", () => {
		const entry = getSpecStatus(validStatus, "01-auth");
		expect(entry.status).toBe("building");
		expect(entry.iterations).toHaveLength(1);
	});

	it("returns default for unknown spec", () => {
		const entry = getSpecStatus(validStatus, "unknown-spec");
		expect(entry.status).toBe("pending");
		expect(entry.plannedAt).toBeNull();
		expect(entry.iterations).toEqual([]);
	});
});

describe("addIteration", () => {
	it("appends to existing iterations array", () => {
		const newIteration = {
			...validIteration,
			iteration: 2,
			startedAt: "2026-01-15T11:00:00Z",
			completedAt: "2026-01-15T11:05:00Z",
		};

		const result = addIteration(validStatus, "01-auth", newIteration);
		expect(result.specs["01-auth"].iterations).toHaveLength(2);
		expect(result.specs["01-auth"].iterations[1].iteration).toBe(2);
	});

	it("creates entry for new spec", () => {
		const result = addIteration(validStatus, "new-spec", validIteration);
		expect(result.specs["new-spec"].iterations).toHaveLength(1);
		expect(result.specs["new-spec"].status).toBe("pending");
	});

	it("does not mutate original status", () => {
		const original = structuredClone(validStatus);
		addIteration(validStatus, "01-auth", validIteration);
		expect(validStatus).toEqual(original);
	});
});

describe("updateSpecStatus", () => {
	it("changes status field", () => {
		const result = updateSpecStatus(validStatus, "01-auth", "done");
		expect(result.specs["01-auth"].status).toBe("done");
	});

	it("preserves other fields", () => {
		const result = updateSpecStatus(validStatus, "01-auth", "done");
		expect(result.specs["01-auth"].iterations).toHaveLength(1);
		expect(result.specs["01-auth"].plannedAt).toBe("2026-01-15T09:00:00Z");
	});

	it("creates entry for new spec with given status", () => {
		const result = updateSpecStatus(validStatus, "new-spec", "planned");
		expect(result.specs["new-spec"].status).toBe("planned");
		expect(result.specs["new-spec"].iterations).toEqual([]);
	});

	it("does not mutate original status", () => {
		const original = structuredClone(validStatus);
		updateSpecStatus(validStatus, "01-auth", "done");
		expect(validStatus).toEqual(original);
	});

	it("transitions pending → planned → building → done", () => {
		let status = { specs: {} } as StatusData;
		status = updateSpecStatus(status, "my-spec", "planned");
		expect(status.specs["my-spec"].status).toBe("planned");
		status = updateSpecStatus(status, "my-spec", "building");
		expect(status.specs["my-spec"].status).toBe("building");
		status = updateSpecStatus(status, "my-spec", "done");
		expect(status.specs["my-spec"].status).toBe("done");
	});
});

describe("SessionSchema", () => {
	it("validates a valid session object", () => {
		const result = SessionSchema.parse({
			name: "warm-lynx-52",
			cli: "claude",
			specs: ["01-auth", "02-api"],
			state: "active",
			startedAt: "2026-03-20T00:00:00.000Z",
		});
		expect(result.name).toBe("warm-lynx-52");
		expect(result.state).toBe("active");
	});

	it("accepts interrupted state", () => {
		const result = SessionSchema.parse({
			name: "warm-lynx-52",
			cli: "claude",
			specs: ["01-auth"],
			state: "interrupted",
			startedAt: "2026-03-20T00:00:00.000Z",
		});
		expect(result.state).toBe("interrupted");
	});

	it("rejects invalid state", () => {
		expect(() => SessionSchema.parse({
			name: "warm-lynx-52",
			cli: "claude",
			specs: [],
			state: "invalid",
			startedAt: "2026-03-20T00:00:00.000Z",
		})).toThrow();
	});
});

describe("SessionStateSchema", () => {
	it("accepts active and interrupted", () => {
		expect(SessionStateSchema.parse("active")).toBe("active");
		expect(SessionStateSchema.parse("interrupted")).toBe("interrupted");
	});

	it("rejects invalid state", () => {
		expect(() => SessionStateSchema.parse("done")).toThrow();
	});
});

describe("createSession", () => {
	it("returns a session with all fields", () => {
		const session = createSession("warm-lynx-52", "claude", ["01-auth", "02-api"]);
		expect(session.name).toBe("warm-lynx-52");
		expect(session.cli).toBe("claude");
		expect(session.specs).toEqual(["01-auth", "02-api"]);
		expect(session.state).toBe("active");
		expect(new Date(session.startedAt).toISOString()).toBe(session.startedAt);
	});
});

describe("updateSessionState", () => {
	it("transitions state from active to interrupted", () => {
		const status: StatusData = {
			specs: {},
			session: createSession("warm-lynx-52", "claude", ["01-auth"]),
		};
		const result = updateSessionState(status, "interrupted");
		expect(result.session?.state).toBe("interrupted");
	});

	it("returns unchanged status when no session exists", () => {
		const status: StatusData = { specs: {} };
		const result = updateSessionState(status, "interrupted");
		expect(result.session).toBeUndefined();
	});
});

describe("clearSession", () => {
	it("removes session from status", () => {
		const status: StatusData = {
			specs: {},
			session: createSession("warm-lynx-52", "claude", ["01-auth"]),
		};
		const result = clearSession(status);
		expect(result.session).toBeUndefined();
		expect(result.specs).toEqual({});
	});
});

describe("hasResumableSession", () => {
	it("returns true for interrupted session", () => {
		const status: StatusData = {
			specs: {},
			session: { ...createSession("warm-lynx-52", "claude", ["01-auth"]), state: "interrupted" },
		};
		expect(hasResumableSession(status)).toBe(true);
	});

	it("returns true for active session (crashed process)", () => {
		const status: StatusData = {
			specs: {},
			session: createSession("warm-lynx-52", "claude", ["01-auth"]),
		};
		expect(hasResumableSession(status)).toBe(true);
	});

	it("returns false when no session", () => {
		const status: StatusData = { specs: {} };
		expect(hasResumableSession(status)).toBe(false);
	});
});

describe("integration: spec with multiple iterations", () => {
	it("accumulates 3 build iterations with correct session IDs", () => {
		let status = { specs: {} } as StatusData;
		const sessions = ["sess-001", "sess-002", "sess-003"];

		for (let i = 0; i < 3; i++) {
			status = addIteration(status, "feature-spec", {
				...validIteration,
				iteration: i + 1,
				sessionId: sessions[i],
			});
		}

		const iters = status.specs["feature-spec"].iterations;
		expect(iters).toHaveLength(3);
		expect(iters.map((it) => it.sessionId)).toEqual(sessions);
		expect(iters.map((it) => it.iteration)).toEqual([1, 2, 3]);
	});
});
