import { describe, it, expect, vi, afterEach } from "vitest";
import type { CliEvent } from "@0xtiby/spawner";
import { writeEvent, writeEventPlain } from "./stream.js";

function makeEvent(overrides: Partial<CliEvent>): CliEvent {
	return {
		type: "text",
		timestamp: Date.now(),
		raw: "",
		...overrides,
	} as CliEvent;
}

describe("writeEvent", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("outputs text events in non-verbose mode", () => {
		const spy = vi.spyOn(process.stdout, "write").mockReturnValue(true);
		writeEvent(makeEvent({ type: "text", content: "hello" }), false);
		expect(spy).toHaveBeenCalledWith(expect.stringContaining("hello"));
	});

	it("skips non-text events in non-verbose mode", () => {
		const spy = vi.spyOn(process.stdout, "write").mockReturnValue(true);
		writeEvent(makeEvent({ type: "tool_use", tool: { name: "bash" } }), false);
		expect(spy).not.toHaveBeenCalled();
	});

	it("outputs tool_use events in verbose mode", () => {
		const spy = vi.spyOn(process.stdout, "write").mockReturnValue(true);
		writeEvent(makeEvent({ type: "tool_use", tool: { name: "bash" } }), true);
		expect(spy).toHaveBeenCalledWith(expect.stringContaining("bash"));
	});

	it("outputs error events in verbose mode", () => {
		const spy = vi.spyOn(process.stdout, "write").mockReturnValue(true);
		writeEvent(makeEvent({ type: "error", content: "fail" }), true);
		expect(spy).toHaveBeenCalledWith(expect.stringContaining("fail"));
	});
});

describe("writeEventPlain", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("outputs text content without color codes", () => {
		const spy = vi.spyOn(process.stdout, "write").mockReturnValue(true);
		writeEventPlain(makeEvent({ type: "text", content: "plain" }), false);
		const output = spy.mock.calls[0][0] as string;
		expect(output).toContain("plain");
		// No ANSI escape codes
		expect(output).not.toMatch(/\x1b\[/);
	});

	it("skips non-text events in non-verbose mode", () => {
		const spy = vi.spyOn(process.stdout, "write").mockReturnValue(true);
		writeEventPlain(makeEvent({ type: "tool_use", tool: { name: "bash" } }), false);
		expect(spy).not.toHaveBeenCalled();
	});
});
