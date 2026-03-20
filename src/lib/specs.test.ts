import { describe, expect, it } from "vitest";
import { parseSpecOrder, sortSpecs } from "./specs.js";

describe("parseSpecOrder", () => {
	it("extracts numeric prefix from 01-auth.md", () => {
		expect(parseSpecOrder("01-auth.md")).toBe(1);
	});

	it("extracts numeric prefix from 10-payments.md", () => {
		expect(parseSpecOrder("10-payments.md")).toBe(10);
	});

	it("returns null for filename without numeric prefix", () => {
		expect(parseSpecOrder("feature.md")).toBeNull();
	});

	it("returns null for non-numeric prefix like AA-auth.md", () => {
		expect(parseSpecOrder("AA-auth.md")).toBeNull();
	});

	it("handles large numeric prefixes", () => {
		expect(parseSpecOrder("99-final.md")).toBe(99);
	});
});

describe("sortSpecs", () => {
	const spec = (name: string, order: number | null) => ({ name, order });

	it("sorts numbered specs ascending", () => {
		const specs = [spec("10-payments", 10), spec("01-auth", 1), spec("05-users", 5)];
		const sorted = sortSpecs(specs);
		expect(sorted.map((s) => s.name)).toEqual(["01-auth", "05-users", "10-payments"]);
	});

	it("places unnumbered specs after numbered ones", () => {
		const specs = [spec("readme", null), spec("01-auth", 1)];
		const sorted = sortSpecs(specs);
		expect(sorted.map((s) => s.name)).toEqual(["01-auth", "readme"]);
	});

	it("sorts unnumbered specs alphabetically", () => {
		const specs = [spec("zebra", null), spec("alpha", null), spec("mid", null)];
		const sorted = sortSpecs(specs);
		expect(sorted.map((s) => s.name)).toEqual(["alpha", "mid", "zebra"]);
	});

	it("breaks duplicate numeric prefix ties alphabetically", () => {
		const specs = [spec("01-beta", 1), spec("01-alpha", 1)];
		const sorted = sortSpecs(specs);
		expect(sorted.map((s) => s.name)).toEqual(["01-alpha", "01-beta"]);
	});

	it("handles mixed numbered and unnumbered specs", () => {
		const specs = [
			spec("zebra", null),
			spec("03-config", 3),
			spec("alpha", null),
			spec("01-auth", 1),
		];
		const sorted = sortSpecs(specs);
		expect(sorted.map((s) => s.name)).toEqual(["01-auth", "03-config", "alpha", "zebra"]);
	});

	it("does not mutate the original array", () => {
		const specs = [spec("02-b", 2), spec("01-a", 1)];
		const original = [...specs];
		sortSpecs(specs);
		expect(specs).toEqual(original);
	});
});
