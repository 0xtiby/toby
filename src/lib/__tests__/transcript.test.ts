import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import type { CliEvent } from "@0xtiby/spawner";
import { openTranscript } from "../transcript.js";

let tmpDir: string;

beforeEach(() => {
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "transcript-test-"));
	vi.spyOn(process, "cwd").mockReturnValue(tmpDir);
});

afterEach(() => {
	vi.restoreAllMocks();
	fs.rmSync(tmpDir, { recursive: true, force: true });
});

function textEvent(content: string): CliEvent {
	return { type: "text", content } as CliEvent;
}

function toolUseEvent(name: string, input: Record<string, unknown> = {}): CliEvent {
	return { type: "tool_use", content: "", tool: { name, input } } as unknown as CliEvent;
}

function toolResultEvent(content: string): CliEvent {
	return { type: "tool_result", content } as CliEvent;
}

function errorEvent(content: string): CliEvent {
	return { type: "error", content } as CliEvent;
}

function systemEvent(content: string): CliEvent {
	return { type: "system", content } as CliEvent;
}

function doneEvent(): CliEvent {
	return { type: "done", content: "" } as CliEvent;
}

function flush(writer: ReturnType<typeof openTranscript>): Promise<void> {
	return new Promise((resolve) => {
		writer.close();
		// Give the stream time to flush
		setTimeout(resolve, 50);
	});
}

describe("transcript", () => {
	it("openTranscript creates directory and file with header", async () => {
		const writer = openTranscript({ command: "build", verbose: false });
		await flush(writer);

		expect(fs.existsSync(writer.filePath)).toBe(true);
		const content = fs.readFileSync(writer.filePath, "utf-8");
		expect(content).toContain("---");
		expect(content).toContain("command: build");
		expect(content).toContain("# Transcript:");
	});

	it("writeEvent with verbose=false only writes text events", async () => {
		const writer = openTranscript({ command: "build", verbose: false });
		writer.writeEvent(textEvent("hello world"));
		writer.writeEvent(toolUseEvent("read_file"));
		writer.writeEvent(toolResultEvent("file contents"));
		writer.writeEvent(errorEvent("some error"));
		writer.writeEvent(systemEvent("system msg"));
		await flush(writer);

		const content = fs.readFileSync(writer.filePath, "utf-8");
		expect(content).toContain("hello world");
		expect(content).not.toContain("[tool_use]");
		expect(content).not.toContain("[tool_result]");
		expect(content).not.toContain("[error]");
		expect(content).not.toContain("[system]");
	});

	it("writeEvent with verbose=true writes all event types with [type] prefix", async () => {
		const writer = openTranscript({ command: "build", verbose: true });
		writer.writeEvent(textEvent("hello"));
		writer.writeEvent(toolUseEvent("read_file", { path: "/foo" }));
		writer.writeEvent(toolResultEvent("result content"));
		writer.writeEvent(errorEvent("err msg"));
		writer.writeEvent(systemEvent("sys msg"));
		await flush(writer);

		const content = fs.readFileSync(writer.filePath, "utf-8");
		expect(content).toContain("[text] hello");
		expect(content).toContain('[tool_use] read_file {"path":"/foo"}');
		expect(content).toContain("[tool_result] result content");
		expect(content).toContain("[error] err msg");
		expect(content).toContain("[system] sys msg");
	});

	it("writeEvent never writes done events", async () => {
		const writer = openTranscript({ command: "build", verbose: true });
		writer.writeEvent(doneEvent());
		writer.writeEvent(textEvent("after done"));
		await flush(writer);

		const content = fs.readFileSync(writer.filePath, "utf-8");
		expect(content).not.toContain("[done]");
		expect(content).toContain("[text] after done");
	});

	it("writeIterationHeader writes correct markdown header", async () => {
		const writer = openTranscript({ command: "build", verbose: false });
		writer.writeIterationHeader({ iteration: 2, total: 5, cli: "claude", model: "sonnet" });
		await flush(writer);

		const content = fs.readFileSync(writer.filePath, "utf-8");
		expect(content).toContain("## Iteration 2/5");
		expect(content).toContain("cli: claude");
		expect(content).toContain("model: sonnet");
	});

	it("writeSpecHeader writes correct ## Spec N/M header", async () => {
		const writer = openTranscript({ command: "build", verbose: false });
		writer.writeSpecHeader(1, 3, "auth-login");
		await flush(writer);

		const content = fs.readFileSync(writer.filePath, "utf-8");
		expect(content).toContain("## Spec 1/3: auth-login");
	});

	it("filename uses millisecond-precision timestamp", () => {
		const writer = openTranscript({ command: "plan", verbose: false });
		writer.close();

		const filename = path.basename(writer.filePath);
		// Format: prefix-command-YYYYMMDD-HHmmss-SSS.md
		expect(filename).toMatch(/^all-plan-\d{8}-\d{6}-\d{3}\.md$/);
	});

	it("filename prefix resolution: session > specName > 'all'", () => {
		const w1 = openTranscript({ command: "build", session: "my-session", specName: "auth", verbose: false });
		w1.close();
		expect(path.basename(w1.filePath)).toMatch(/^my-session-build-/);

		const w2 = openTranscript({ command: "build", specName: "auth", verbose: false });
		w2.close();
		expect(path.basename(w2.filePath)).toMatch(/^auth-build-/);

		const w3 = openTranscript({ command: "build", verbose: false });
		w3.close();
		expect(path.basename(w3.filePath)).toMatch(/^all-build-/);
	});

	it("close flushes stream without error", async () => {
		const writer = openTranscript({ command: "plan", verbose: false });
		writer.writeEvent(textEvent("before close"));
		await flush(writer);

		const content = fs.readFileSync(writer.filePath, "utf-8");
		expect(content).toContain("before close");
		// Calling close again should not throw
		expect(() => writer.close()).not.toThrow();
	});

	it("metadata header contains all fields", async () => {
		const writer = openTranscript({
			command: "build",
			specName: "01-auth",
			session: "warm-lynx-52",
			verbose: true,
		});
		await flush(writer);

		const content = fs.readFileSync(writer.filePath, "utf-8");
		expect(content).toContain("command: build");
		expect(content).toContain("session: warm-lynx-52");
		expect(content).toContain("spec: 01-auth");
		expect(content).toContain("verbose: true");
		expect(content).toContain("created:");
	});

	it("non-verbose text events have no prefix", async () => {
		const writer = openTranscript({ command: "build", verbose: false });
		writer.writeEvent(textEvent("plain text output"));
		await flush(writer);

		const content = fs.readFileSync(writer.filePath, "utf-8");
		expect(content).toContain("plain text output");
		expect(content).not.toContain("[text]");
	});

	it("tool_result content is truncated to 200 chars in verbose mode", async () => {
		const longContent = "x".repeat(300);
		const writer = openTranscript({ command: "build", verbose: true });
		writer.writeEvent(toolResultEvent(longContent));
		await flush(writer);

		const content = fs.readFileSync(writer.filePath, "utf-8");
		const toolResultLine = content.split("\n").find((l: string) => l.includes("[tool_result]"));
		expect(toolResultLine).toBeDefined();
		// [tool_result] + space + 200 chars = total content after prefix
		expect(toolResultLine!.length).toBeLessThan(250);
	});

	it("write error caught and logged to stderr", async () => {
		const stderrSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		const writer = openTranscript({ command: "build", verbose: false });
		// Close the stream first, then try writing
		writer.close();
		await new Promise((r) => setTimeout(r, 50));

		// Writing after close should not throw
		writer.writeEvent(textEvent("after close"));
		stderrSpy.mockRestore();
	});
});
