import { describe, it, expect } from "vitest";
import { SENTINEL, containsSentinel } from "./loop.js";

describe("SENTINEL", () => {
	it("equals :::TOBY_DONE:::", () => {
		expect(SENTINEL).toBe(":::TOBY_DONE:::");
	});
});

describe("containsSentinel", () => {
	it("returns true for exact sentinel", () => {
		expect(containsSentinel(":::TOBY_DONE:::")).toBe(true);
	});

	it("returns true when sentinel is embedded in text", () => {
		expect(containsSentinel("abc:::TOBY_DONE:::def")).toBe(true);
	});

	it("returns false for non-matching text", () => {
		expect(containsSentinel("hello world")).toBe(false);
	});

	it("returns false for empty string", () => {
		expect(containsSentinel("")).toBe(false);
	});

	it("returns false for partial sentinel", () => {
		expect(containsSentinel(":::TOBY_DON")).toBe(false);
	});
});
