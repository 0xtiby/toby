import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "ink-testing-library";
import { Text } from "ink";
import { useModels, DEFAULT_ITEM } from "./useModels.js";
import type { UseModelsResult } from "./useModels.js";

vi.mock("@0xtiby/spawner", () => ({
	listModels: vi.fn(async () => [
		{ id: "claude-sonnet-4-20250514", name: "Claude Sonnet 4", provider: "anthropic" },
		{ id: "gpt-4o", name: "GPT-4o", provider: "openai" },
	]),
}));

vi.mock("ink", async () => {
	const actual = await vi.importActual<typeof import("ink")>("ink");
	return {
		...actual,
		useApp: () => ({ exit: vi.fn() }),
	};
});

import { listModels } from "@0xtiby/spawner";

const mockListModels = listModels as ReturnType<typeof vi.fn>;

function TestHarness({ cli, onResult }: { cli: string; onResult: (r: UseModelsResult) => void }) {
	const result = useModels(cli as "claude" | "codex" | "opencode");
	onResult(result);
	return React.createElement(Text, null, result.loading ? "loading" : `items:${result.items.length}`);
}

describe("useModels", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockListModels.mockImplementation(async () => [
			{ id: "claude-sonnet-4-20250514", name: "Claude Sonnet 4", provider: "anthropic" },
			{ id: "gpt-4o", name: "GPT-4o", provider: "openai" },
		]);
	});

	it("returns loading:true initially then loading:false with mapped items", async () => {
		let captured: UseModelsResult | null = null;
		const { lastFrame } = render(
			React.createElement(TestHarness, {
				cli: "claude",
				onResult: (r: UseModelsResult) => { captured = r; },
			}),
		);

		// Wait for async effect to resolve
		await vi.waitFor(() => {
			expect(lastFrame()).toContain("items:");
		});

		expect(captured).not.toBeNull();
		expect(captured!.loading).toBe(false);
		expect(captured!.error).toBeNull();
		expect(captured!.items.length).toBe(3); // default + 2 models
	});

	it("prepends default item and maps model names correctly", async () => {
		let captured: UseModelsResult | null = null;
		const { lastFrame } = render(
			React.createElement(TestHarness, {
				cli: "claude",
				onResult: (r: UseModelsResult) => { captured = r; },
			}),
		);

		await vi.waitFor(() => {
			expect(lastFrame()).toContain("items:");
		});

		expect(captured!.items[0]).toEqual(DEFAULT_ITEM);
		expect(captured!.items[1]).toEqual({
			label: "Claude Sonnet 4 (claude-sonnet-4-20250514)",
			value: "claude-sonnet-4-20250514",
		});
		expect(captured!.items[2]).toEqual({
			label: "GPT-4o (gpt-4o)",
			value: "gpt-4o",
		});
	});

	it("returns [DEFAULT_ITEM] when listModels returns empty array", async () => {
		mockListModels.mockImplementation(async () => []);

		let captured: UseModelsResult | null = null;
		const { lastFrame } = render(
			React.createElement(TestHarness, {
				cli: "claude",
				onResult: (r: UseModelsResult) => { captured = r; },
			}),
		);

		await vi.waitFor(() => {
			expect(lastFrame()).toContain("items:");
		});

		expect(captured!.items).toEqual([DEFAULT_ITEM]);
		expect(captured!.loading).toBe(false);
	});

	it("returns [DEFAULT_ITEM] with error when listModels rejects", async () => {
		mockListModels.mockImplementation(async () => {
			throw new Error("network error");
		});

		let captured: UseModelsResult | null = null;
		const { lastFrame } = render(
			React.createElement(TestHarness, {
				cli: "claude",
				onResult: (r: UseModelsResult) => { captured = r; },
			}),
		);

		await vi.waitFor(() => {
			expect(lastFrame()).toContain("items:");
		});

		expect(captured!.items).toEqual([DEFAULT_ITEM]);
		expect(captured!.loading).toBe(false);
		expect(captured!.error).toBe("network error");
	});

	it("calls listModels with correct cli parameter", async () => {
		const { lastFrame } = render(
			React.createElement(TestHarness, {
				cli: "codex",
				onResult: () => {},
			}),
		);

		await vi.waitFor(() => {
			expect(lastFrame()).toContain("items:");
		});

		expect(mockListModels).toHaveBeenCalledWith({ cli: "codex", fallback: true });
	});
});
