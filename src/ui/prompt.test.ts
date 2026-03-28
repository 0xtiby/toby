import { describe, it, expect, vi, afterEach } from "vitest";
import { handleCancel } from "./prompt.js";

// Mock @clack/prompts
vi.mock("@clack/prompts", () => {
	const cancelSymbol = Symbol("cancel");
	return {
		isCancel: (value: unknown) => value === cancelSymbol,
		cancel: vi.fn(),
		__cancelSymbol: cancelSymbol,
	};
});

describe("handleCancel", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("does nothing for normal values", () => {
		const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
			throw new Error("process.exit called");
		});
		handleCancel("hello");
		handleCancel(42);
		handleCancel(true);
		expect(exitSpy).not.toHaveBeenCalled();
	});

	it("exits on cancel symbol", async () => {
		const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
			throw new Error("process.exit called");
		});
		// Get the cancel symbol from the mock
		const { __cancelSymbol } = await import("@clack/prompts") as { __cancelSymbol: symbol };
		expect(() => handleCancel(__cancelSymbol)).toThrow("process.exit called");
		expect(exitSpy).toHaveBeenCalledWith(0);
	});
});
