import { describe, it, expect } from "vitest";
import { COMMAND_NAMES } from "../cli-meta.js";

describe("COMMAND_NAMES", () => {
	it("exports an array of known command names", () => {
		expect(Array.isArray(COMMAND_NAMES)).toBe(true);
		expect(COMMAND_NAMES.length).toBeGreaterThan(0);
		expect(COMMAND_NAMES).toContain("plan");
		expect(COMMAND_NAMES).toContain("build");
	});
});
