import { describe, it, expect, vi, afterEach } from "vitest";
import { createSpinner, withSpinner } from "./spinner.js";

describe("createSpinner", () => {
	it("returns an ora instance with expected text", () => {
		const spinner = createSpinner("Loading...");
		expect(spinner).toBeDefined();
		expect(spinner.text).toBe("Loading...");
	});
});

describe("withSpinner", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("resolves with the value from the async function", async () => {
		const result = await withSpinner("Working...", async () => 42);
		expect(result).toBe(42);
	});

	it("rethrows on rejection", async () => {
		await expect(
			withSpinner("Failing...", async () => {
				throw new Error("boom");
			}),
		).rejects.toThrow("boom");
	});
});
