import { describe, it, expect, afterEach } from "vitest";
import { isTTY } from "./tty.js";

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
