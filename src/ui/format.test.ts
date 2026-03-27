import { describe, it, expect } from "vitest";
import { banner, formatTokens, formatDuration, specBadge, formatStatusTable } from "./format.js";

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
		};
		const result = banner("1.0.0", stats);
		expect(result).toContain("5");
		expect(result).toContain("12,345");
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
		// Each badge should contain the status text
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
	it("renders a table with headers and rows", () => {
		const rows = [
			{ name: "auth", status: "done", iterations: 3, tokens: 5000 },
			{ name: "payments", status: "pending", iterations: 0, tokens: 0 },
		];
		const result = formatStatusTable(rows);
		expect(result).toContain("Spec");
		expect(result).toContain("auth");
		expect(result).toContain("payments");
		expect(result).toContain("│");
	});
});
