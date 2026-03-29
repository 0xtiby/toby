import { describe, it, expect } from "vitest";
import { banner, formatTokens, formatDuration, specBadge, formatStatusTable, formatDetailTable, formatCost, costSuffix, sumResults } from "./format.js";
import type { SpecStatusEntry } from "../types.js";

describe("banner", () => {
	it("returns string containing version", () => {
		const result = banner("1.2.3");
		expect(result).toContain("1.2.3");
	});

	it("includes stats when provided", () => {
		const stats = {
			totalSpecs: 5,
			pending: 2,
			planned: 1,
			building: 1,
			done: 1,
			totalIterations: 10,
			totalTokens: 12345,
			totalInputTokens: 0,
			totalOutputTokens: 0,
			totalCost: 0,
		};
		const result = banner("1.0.0", stats);
		expect(result).toContain("5");
		expect(result).toContain("12,345");
	});

	it("includes cost in stats line when totalCost > 0", () => {
		const stats = {
			totalSpecs: 3,
			pending: 0,
			planned: 1,
			building: 0,
			done: 2,
			totalIterations: 5,
			totalTokens: 8000,
			totalInputTokens: 5000,
			totalOutputTokens: 3000,
			totalCost: 1.84,
		};
		const result = banner("1.0.0", stats);
		expect(result).toContain("Cost:");
		expect(result).toContain("$1.84");
	});

	it("omits cost segment when totalCost is 0", () => {
		const stats = {
			totalSpecs: 2,
			pending: 1,
			planned: 1,
			building: 0,
			done: 0,
			totalIterations: 0,
			totalTokens: 0,
			totalInputTokens: 0,
			totalOutputTokens: 0,
			totalCost: 0,
		};
		const result = banner("1.0.0", stats);
		expect(result).not.toContain("Cost:");
	});
});

describe("formatCost", () => {
	it("returns dash for null", () => {
		expect(formatCost(null)).toBe("—");
	});

	it("returns $0.00 for zero", () => {
		expect(formatCost(0)).toBe("$0.00");
	});

	it("rounds to 2 decimal places", () => {
		expect(formatCost(0.4231)).toBe("$0.42");
		expect(formatCost(1.5)).toBe("$1.50");
		expect(formatCost(10.999)).toBe("$11.00");
	});

	it("shows 4 decimal places for sub-cent values", () => {
		expect(formatCost(0.003)).toBe("$0.0030");
		expect(formatCost(0.0001)).toBe("$0.0001");
		expect(formatCost(0.0099)).toBe("$0.0099");
	});

	it("uses 2 decimal places at the $0.01 boundary", () => {
		expect(formatCost(0.01)).toBe("$0.01");
	});
});

describe("costSuffix", () => {
	it("returns empty string when cost is zero", () => {
		expect(costSuffix(0)).toBe("");
	});

	it("returns formatted cost with default prefix", () => {
		expect(costSuffix(1.50)).toBe(", $1.50");
	});

	it("accepts custom prefix", () => {
		expect(costSuffix(1.50, { prefix: " · " })).toBe(" · $1.50");
	});
});

describe("sumResults", () => {
	it("sums totalIterations, totalTokens, totalCost", () => {
		const results = [
			{ totalIterations: 3, totalTokens: 1000, totalCost: 0.10 },
			{ totalIterations: 2, totalTokens: 500, totalCost: 0.05 },
		];
		const result = sumResults(results);
		expect(result.totalIter).toBe(5);
		expect(result.totalTok).toBe(1500);
		expect(result.totalCost).toBeCloseTo(0.15);
	});

	it("returns zeros for empty array", () => {
		expect(sumResults([])).toEqual({ totalIter: 0, totalTok: 0, totalCost: 0 });
	});
});

describe("formatTokens", () => {
	it("formats numbers with locale separators", () => {
		expect(formatTokens(0)).toBe("0");
		expect(formatTokens(1000)).toMatch(/1.000|1,000/);
		expect(formatTokens(1234567)).toMatch(/1.234.567|1,234,567/);
	});
});

describe("formatDuration", () => {
	it("returns dash for zero or negative ms", () => {
		expect(formatDuration(0)).toBe("—");
		expect(formatDuration(-100)).toBe("—");
	});

	it("formats milliseconds to minutes and seconds", () => {
		expect(formatDuration(90000)).toBe("1m 30s");
		expect(formatDuration(5000)).toBe("0m 5s");
	});
});

describe("specBadge", () => {
	it("returns colored string for known statuses", () => {
		expect(specBadge("pending")).toContain("pending");
		expect(specBadge("planned")).toContain("planned");
		expect(specBadge("building")).toContain("building");
		expect(specBadge("done")).toContain("done");
	});

	it("returns raw string for unknown status", () => {
		expect(specBadge("unknown")).toBe("unknown");
	});
});

describe("formatStatusTable", () => {
	it("renders a table with headers and rows including new columns", () => {
		const rows = [
			{ name: "auth", status: "done", iterations: 3, inputTokens: 8200, outputTokens: 4100, tokens: 12300, cost: 0.42 },
			{ name: "api", status: "building", iterations: 1, inputTokens: 2000, outputTokens: 800, tokens: 2800, cost: null },
		];
		const result = formatStatusTable(rows);
		expect(result).toContain("Spec");
		expect(result).toContain("Input");
		expect(result).toContain("Output");
		expect(result).toContain("Tokens");
		expect(result).toContain("Cost");
		expect(result).toContain("auth");
		expect(result).toContain("api");
		expect(result).toContain("$0.42");
		expect(result).toContain("│");
	});

	it("renders dash for null cost", () => {
		const rows = [
			{ name: "auth", status: "done", iterations: 1, inputTokens: 0, outputTokens: 0, tokens: 0, cost: null },
		];
		const result = formatStatusTable(rows);
		expect(result).toContain("—");
	});

	it("formats token values with comma separators", () => {
		const rows = [
			{ name: "auth", status: "done", iterations: 2, inputTokens: 8200, outputTokens: 4100, tokens: 12300, cost: 0.42 },
		];
		const result = formatStatusTable(rows);
		expect(result).toMatch(/8.200|8,200/);
		expect(result).toMatch(/12.300|12,300/);
	});
});

describe("formatDetailTable", () => {
	function makeEntry(overrides: Partial<SpecStatusEntry> = {}): SpecStatusEntry {
		return {
			status: "done",
			plannedAt: null,
			iterations: [],
			...overrides,
		};
	}

	it("shows 'No iterations yet' when empty", () => {
		const result = formatDetailTable("01-auth", makeEntry());
		expect(result).toContain("No iterations yet");
	});

	it("renders Input, Output, Tokens, Cost columns per iteration", () => {
		const entry = makeEntry({
			iterations: [
				{
					type: "build",
					iteration: 1,
					sessionId: "s1",
					state: "complete",
					cli: "claude",
					model: "opus",
					startedAt: "2026-01-01T00:00:00Z",
					completedAt: "2026-01-01T00:02:30Z",
					exitCode: 0,
					taskCompleted: null,
					tokensUsed: 4000,
					inputTokens: 2800,
					outputTokens: 1200,
					cost: 0.15,
				},
			],
		});
		const result = formatDetailTable("01-auth", entry);
		expect(result).toContain("Input");
		expect(result).toContain("Output");
		expect(result).toContain("Cost");
		expect(result).toContain("$0.15");
		expect(result).toMatch(/2.800|2,800/);
	});

	it("renders dash for null inputTokens/outputTokens/cost", () => {
		const entry = makeEntry({
			iterations: [
				{
					type: "plan",
					iteration: 1,
					sessionId: null,
					state: "complete",
					cli: "claude",
					model: "opus",
					startedAt: "2026-01-01T00:00:00Z",
					completedAt: "2026-01-01T00:01:00Z",
					exitCode: 0,
					taskCompleted: null,
					tokensUsed: 1000,
					inputTokens: null,
					outputTokens: null,
					cost: null,
				},
			],
		});
		const result = formatDetailTable("01-auth", entry);
		expect(result).toContain("—");
	});

	it("summary includes Input tokens, Output tokens, Tokens used", () => {
		const entry = makeEntry({
			iterations: [
				{
					type: "build",
					iteration: 1,
					sessionId: "s1",
					state: "complete",
					cli: "claude",
					model: "opus",
					startedAt: "2026-01-01T00:00:00Z",
					completedAt: "2026-01-01T00:02:00Z",
					exitCode: 0,
					taskCompleted: null,
					tokensUsed: 5900,
					inputTokens: 3500,
					outputTokens: 2400,
					cost: 0.22,
				},
			],
		});
		const result = formatDetailTable("01-auth", entry);
		expect(result).toContain("Input tokens:");
		expect(result).toContain("Output tokens:");
		expect(result).toContain("Tokens used:");
		expect(result).toContain("Cost:");
		expect(result).toContain("$0.22");
	});

	it("omits Cost line in summary when all costs are null", () => {
		const entry = makeEntry({
			iterations: [
				{
					type: "plan",
					iteration: 1,
					sessionId: null,
					state: "complete",
					cli: "claude",
					model: "opus",
					startedAt: "2026-01-01T00:00:00Z",
					completedAt: "2026-01-01T00:01:00Z",
					exitCode: 0,
					taskCompleted: null,
					tokensUsed: 1000,
					inputTokens: null,
					outputTokens: null,
					cost: null,
				},
			],
		});
		const result = formatDetailTable("01-auth", entry);
		// Summary should not include "Cost:" line since no cost data
		const lines = result.split("\n");
		const costLine = lines.find((l) => l.startsWith("Cost:"));
		expect(costLine).toBeUndefined();
	});
});
