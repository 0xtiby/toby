import { describe, it, expect } from "vitest";
import type { CliEvent } from "@0xtiby/spawner";
import { filterEvents, formatEvent } from "./StreamOutput.js";

function makeEvent(type: CliEvent["type"], content?: string, tool?: { name: string }): CliEvent {
	return { type, timestamp: Date.now(), content, tool } as CliEvent;
}

describe("filterEvents", () => {
	const events: CliEvent[] = [
		makeEvent("text", "Hello"),
		makeEvent("tool_use", undefined, { name: "Read" }),
		makeEvent("tool_result", "file contents"),
		makeEvent("text", "World"),
		makeEvent("error", "something failed"),
		makeEvent("system", "session started"),
	];

	it("default mode filters to only text events", () => {
		const filtered = filterEvents(events, false);
		expect(filtered).toHaveLength(2);
		expect(filtered.every((e) => e.type === "text")).toBe(true);
	});

	it("verbose mode returns all events", () => {
		const filtered = filterEvents(events, true);
		expect(filtered).toHaveLength(events.length);
	});

	it("returns empty array when no text events in default mode", () => {
		const nonTextEvents = [
			makeEvent("tool_use", undefined, { name: "Bash" }),
			makeEvent("system", "init"),
		];
		expect(filterEvents(nonTextEvents, false)).toHaveLength(0);
	});

	it("returns empty array for empty input", () => {
		expect(filterEvents([], false)).toHaveLength(0);
		expect(filterEvents([], true)).toHaveLength(0);
	});
});

describe("formatEvent", () => {
	it("formats text events with content", () => {
		expect(formatEvent(makeEvent("text", "Hello world"))).toBe("Hello world");
	});

	it("formats text events with empty content", () => {
		expect(formatEvent(makeEvent("text"))).toBe("");
	});

	it("formats tool_use events with tool name", () => {
		expect(formatEvent(makeEvent("tool_use", undefined, { name: "Read" }))).toBe("⚙ Read");
	});

	it("formats tool_use events without tool name", () => {
		expect(formatEvent(makeEvent("tool_use"))).toBe("⚙ tool");
	});

	it("formats tool_result events truncated to 120 chars", () => {
		const longContent = "x".repeat(200);
		const formatted = formatEvent(makeEvent("tool_result", longContent));
		expect(formatted).toBe(`  ↳ ${"x".repeat(120)}`);
	});

	it("formats error events", () => {
		expect(formatEvent(makeEvent("error", "bad thing"))).toBe("✗ bad thing");
	});

	it("formats system events", () => {
		expect(formatEvent(makeEvent("system", "starting"))).toBe("[system] starting");
	});
});
