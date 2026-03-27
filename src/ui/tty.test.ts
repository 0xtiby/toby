import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { isTTY, requireTTY } from "./tty.js";

describe("isTTY", () => {
	const originalIsTTY = process.stdout.isTTY;

	afterEach(() => {
		Object.defineProperty(process.stdout, "isTTY", {
			value: originalIsTTY,
			writable: true,
			configurable: true,
		});
	});

	it("returns true when stdout is a TTY", () => {
		Object.defineProperty(process.stdout, "isTTY", {
			value: true,
			writable: true,
			configurable: true,
		});
		expect(isTTY()).toBe(true);
	});

	it("returns false when stdout is not a TTY", () => {
		Object.defineProperty(process.stdout, "isTTY", {
			value: undefined,
			writable: true,
			configurable: true,
		});
		expect(isTTY()).toBe(false);
	});
});

describe("requireTTY", () => {
	const originalIsTTY = process.stdout.isTTY;

	beforeEach(() => {
		vi.spyOn(console, "error").mockImplementation(() => {});
		vi.spyOn(process, "exit").mockImplementation(() => {
			throw new Error("process.exit called");
		});
	});

	afterEach(() => {
		vi.restoreAllMocks();
		Object.defineProperty(process.stdout, "isTTY", {
			value: originalIsTTY,
			writable: true,
			configurable: true,
		});
	});

	it("does nothing when TTY", () => {
		Object.defineProperty(process.stdout, "isTTY", {
			value: true,
			writable: true,
			configurable: true,
		});
		requireTTY("init", "Use --plan-cli and --build-cli flags instead.");
		expect(process.exit).not.toHaveBeenCalled();
	});

	it("exits with code 1 when not TTY", () => {
		Object.defineProperty(process.stdout, "isTTY", {
			value: undefined,
			writable: true,
			configurable: true,
		});
		expect(() =>
			requireTTY("init", "Use --plan-cli and --build-cli flags instead."),
		).toThrow("process.exit called");
		expect(process.exit).toHaveBeenCalledWith(1);
		expect(console.error).toHaveBeenCalledWith(
			expect.stringContaining("toby init requires an interactive terminal"),
		);
	});
});
