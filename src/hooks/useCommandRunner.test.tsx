import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "ink-testing-library";
import { Text } from "ink";
import { useCommandRunner } from "./useCommandRunner.js";
import type { CommandFlags, Phase } from "./useCommandRunner.js";
import type { Spec } from "../lib/specs.js";
import { findSpecs } from "../lib/specs.js";

// Mock ink's useApp
vi.mock("ink", async () => {
	const actual = await vi.importActual<typeof import("ink")>("ink");
	return {
		...actual,
		useApp: () => ({ exit: vi.fn() }),
	};
});

// Mock config and specs discovery
vi.mock("../lib/config.js", () => ({
	loadConfig: vi.fn(() => ({ verbose: false })),
}));

vi.mock("../lib/specs.js", () => ({
	discoverSpecs: vi.fn(() => []),
	findSpecs: vi.fn(() => []),
}));

function PhaseCapture({ flags, onPhase }: { flags: CommandFlags; onPhase: (p: Phase) => void }) {
	const runner = useCommandRunner({ flags, runPhase: "planning" });
	onPhase(runner.phase);
	return <Text>{runner.phase}</Text>;
}

function MultiSpecCapture({
	flags,
	onResult,
}: {
	flags: CommandFlags;
	onResult: (r: { phase: Phase; handleMultiSpecConfirm: (specs: Spec[]) => void; selectedSpecs: Spec[] }) => void;
}) {
	const runner = useCommandRunner({ flags, runPhase: "planning" });
	onResult({
		phase: runner.phase,
		handleMultiSpecConfirm: runner.handleMultiSpecConfirm,
		selectedSpecs: runner.selectedSpecs,
	});
	return <Text>{runner.phase}</Text>;
}

describe("useCommandRunner", () => {
	const baseFlags: CommandFlags = {
		all: false,
		verbose: false,
	};

	it("sets phase to 'multi' when flags.spec contains comma", () => {
		vi.mocked(findSpecs).mockReturnValue([]);
		let captured: Phase = "init";
		render(<PhaseCapture flags={{ ...baseFlags, spec: "auth,payments" }} onPhase={(p) => { captured = p; }} />);
		expect(captured).toBe("multi");
	});

	it("sets phase to 'init' when flags.spec has no comma", () => {
		let captured: Phase = "multi";
		render(<PhaseCapture flags={{ ...baseFlags, spec: "auth" }} onPhase={(p) => { captured = p; }} />);
		expect(captured).toBe("init");
	});

	it("sets phase to 'all' when flags.all is true regardless of spec", () => {
		let captured: Phase = "init";
		render(<PhaseCapture flags={{ ...baseFlags, all: true, spec: "auth,payments" }} onPhase={(p) => { captured = p; }} />);
		expect(captured).toBe("all");
	});

	it("sets phase to 'selecting' when no spec and not all", () => {
		let captured: Phase = "init";
		render(<PhaseCapture flags={baseFlags} onPhase={(p) => { captured = p; }} />);
		expect(captured).toBe("selecting");
	});

	it("handleMultiSpecConfirm with 1 spec sets phase to 'init'", async () => {
		const mockFindSpecs = vi.mocked(findSpecs);
		const resolvedSpecs: Spec[] = [
			{ name: "01-auth", path: "/specs/01-auth.md", order: { num: 1, suffix: null }, status: "pending" },
			{ name: "02-payments", path: "/specs/02-payments.md", order: { num: 2, suffix: null }, status: "pending" },
		];
		mockFindSpecs.mockReturnValue(resolvedSpecs);

		let result: { phase: Phase; handleMultiSpecConfirm: (specs: Spec[]) => void; selectedSpecs: Spec[] } | null = null;
		const { rerender } = render(
			<MultiSpecCapture
				flags={{ ...baseFlags, spec: "auth,payments" }}
				onResult={(r) => { result = r; }}
			/>,
		);

		// Phase is "multi" initially; the resolution effect will populate selectedSpecs
		expect(result!.phase).toBe("multi");

		const singleSpec: Spec = { name: "01-auth", path: "/specs/01-auth.md", order: { num: 1, suffix: null }, status: "pending" };

		// Call handleMultiSpecConfirm with 1 spec — React will batch the update
		await vi.waitFor(() => {
			result!.handleMultiSpecConfirm([singleSpec]);
			// Force re-render to capture new phase
			rerender(
				<MultiSpecCapture
					flags={{ ...baseFlags, spec: "auth,payments" }}
					onResult={(r) => { result = r; }}
				/>,
			);
			expect(result!.phase).toBe("init");
		});
	});

	it("handleMultiSpecConfirm with 2+ specs sets phase to 'multi' and stores selectedSpecs", async () => {
		let result: { phase: Phase; handleMultiSpecConfirm: (specs: Spec[]) => void; selectedSpecs: Spec[] } | null = null;
		const { rerender } = render(
			<MultiSpecCapture
				flags={baseFlags}
				onResult={(r) => { result = r; }}
			/>,
		);

		expect(result!.phase).toBe("selecting");

		const multiSpecs: Spec[] = [
			{ name: "01-auth", path: "/specs/01-auth.md", order: { num: 1, suffix: null }, status: "pending" },
			{ name: "02-payments", path: "/specs/02-payments.md", order: { num: 2, suffix: null }, status: "pending" },
		];

		await vi.waitFor(() => {
			result!.handleMultiSpecConfirm(multiSpecs);
			rerender(
				<MultiSpecCapture
					flags={baseFlags}
					onResult={(r) => { result = r; }}
				/>,
			);
			expect(result!.phase).toBe("multi");
			expect(result!.selectedSpecs).toEqual(multiSpecs);
		});
	});
});
