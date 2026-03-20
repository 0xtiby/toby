import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ConfigSchema } from "../types.js";
import {
	discoverSpecs,
	filterByStatus,
	findSpec,
	loadSpecContent,
	parseSpecOrder,
	sortSpecs,
} from "./specs.js";
import type { Spec } from "./specs.js";

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

describe("discoverSpecs", () => {
	let tmpDir: string;
	const defaultConfig = ConfigSchema.parse({});

	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "toby-specs-test-"));
	});

	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	function writeSpecFile(filename: string, content = "# Spec") {
		const specsDir = path.join(tmpDir, "specs");
		fs.mkdirSync(specsDir, { recursive: true });
		fs.writeFileSync(path.join(specsDir, filename), content);
	}

	function writeStatusJson(specs: Record<string, { status: string }>) {
		const tobyDir = path.join(tmpDir, ".toby");
		fs.mkdirSync(tobyDir, { recursive: true });
		fs.writeFileSync(
			path.join(tobyDir, "status.json"),
			JSON.stringify({
				specs: Object.fromEntries(
					Object.entries(specs).map(([name, entry]) => [
						name,
						{ status: entry.status, plannedAt: null, iterations: [] },
					]),
				),
			}),
		);
	}

	it("returns sorted specs from valid dir", () => {
		writeSpecFile("02-payments.md");
		writeSpecFile("01-auth.md");
		const specs = discoverSpecs(tmpDir, defaultConfig);
		expect(specs.map((s) => s.name)).toEqual(["01-auth", "02-payments"]);
		expect(specs[0].order).toBe(1);
		expect(specs[1].order).toBe(2);
	});

	it("excludes files matching excludeSpecs", () => {
		writeSpecFile("01-auth.md");
		writeSpecFile("README.md");
		const specs = discoverSpecs(tmpDir, defaultConfig);
		expect(specs.map((s) => s.name)).toEqual(["01-auth"]);
	});

	it("returns empty array for missing specs dir", () => {
		const specs = discoverSpecs(tmpDir, defaultConfig);
		expect(specs).toEqual([]);
	});

	it("returns empty array when no .md files exist", () => {
		const specsDir = path.join(tmpDir, "specs");
		fs.mkdirSync(specsDir, { recursive: true });
		fs.writeFileSync(path.join(specsDir, "notes.txt"), "not a spec");
		const specs = discoverSpecs(tmpDir, defaultConfig);
		expect(specs).toEqual([]);
	});

	it("uses custom specsDir from config", () => {
		const customDir = path.join(tmpDir, "features");
		fs.mkdirSync(customDir, { recursive: true });
		fs.writeFileSync(path.join(customDir, "01-auth.md"), "# Auth");
		const config = ConfigSchema.parse({ specsDir: "features" });
		const specs = discoverSpecs(tmpDir, config);
		expect(specs.map((s) => s.name)).toEqual(["01-auth"]);
	});

	it("looks up status from status.json", () => {
		writeSpecFile("01-auth.md");
		writeSpecFile("02-payments.md");
		writeStatusJson({ "01-auth": { status: "planned" } });
		const specs = discoverSpecs(tmpDir, defaultConfig);
		expect(specs[0].status).toBe("planned");
		expect(specs[1].status).toBe("pending");
	});

	it("defaults to pending when spec not in status.json", () => {
		writeSpecFile("01-auth.md");
		const specs = discoverSpecs(tmpDir, defaultConfig);
		expect(specs[0].status).toBe("pending");
	});

	it("does not traverse nested directories", () => {
		writeSpecFile("01-auth.md");
		const nestedDir = path.join(tmpDir, "specs", "nested");
		fs.mkdirSync(nestedDir, { recursive: true });
		fs.writeFileSync(path.join(nestedDir, "02-deep.md"), "# Deep");
		const specs = discoverSpecs(tmpDir, defaultConfig);
		expect(specs.map((s) => s.name)).toEqual(["01-auth"]);
	});

	it("sets correct path for each spec", () => {
		writeSpecFile("01-auth.md");
		const specs = discoverSpecs(tmpDir, defaultConfig);
		expect(specs[0].path).toBe(path.join(tmpDir, "specs", "01-auth.md"));
	});
});

describe("loadSpecContent", () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "toby-load-test-"));
	});

	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	it("loads file content into spec", () => {
		const filePath = path.join(tmpDir, "01-auth.md");
		fs.writeFileSync(filePath, "# Auth Spec\nDetails here.");
		const spec = { name: "01-auth", path: filePath };
		const loaded = loadSpecContent(spec);
		expect(loaded.content).toBe("# Auth Spec\nDetails here.");
		expect(loaded.name).toBe("01-auth");
		expect(loaded.path).toBe(filePath);
	});
});

describe("filterByStatus", () => {
	const spec = (name: string, status: Spec["status"]): Spec => ({
		name,
		path: `/specs/${name}.md`,
		order: parseSpecOrder(`${name}.md`),
		status,
	});

	it("returns only specs with matching status", () => {
		const specs = [spec("01-auth", "pending"), spec("02-payments", "planned"), spec("03-config", "pending")];
		const result = filterByStatus(specs, "pending");
		expect(result.map((s) => s.name)).toEqual(["01-auth", "03-config"]);
	});

	it("returns empty array when no specs match", () => {
		const specs = [spec("01-auth", "done"), spec("02-payments", "done")];
		expect(filterByStatus(specs, "pending")).toEqual([]);
	});

	it("returns empty array for empty input", () => {
		expect(filterByStatus([], "pending")).toEqual([]);
	});
});

describe("findSpec", () => {
	const spec = (name: string): Spec => ({
		name,
		path: `/specs/${name}.md`,
		order: parseSpecOrder(`${name}.md`),
		status: "pending",
	});

	const specs = [spec("01-auth"), spec("02-payments"), spec("config")];

	it("matches by name without prefix (e.g. 'auth' matches '01-auth')", () => {
		expect(findSpec(specs, "auth")?.name).toBe("01-auth");
	});

	it("matches by exact name (e.g. '01-auth')", () => {
		expect(findSpec(specs, "01-auth")?.name).toBe("01-auth");
	});

	it("matches by filename with extension (e.g. '01-auth.md')", () => {
		expect(findSpec(specs, "01-auth.md")?.name).toBe("01-auth");
	});

	it("matches unnumbered spec by exact name", () => {
		expect(findSpec(specs, "config")?.name).toBe("config");
	});

	it("returns undefined when no spec matches", () => {
		expect(findSpec(specs, "nonexistent")).toBeUndefined();
	});

	it("first match wins when multiple could match", () => {
		const dupes = [spec("01-auth"), spec("02-auth")];
		// "auth" strips prefix, both match — first wins
		expect(findSpec(dupes, "auth")?.name).toBe("01-auth");
	});
});
