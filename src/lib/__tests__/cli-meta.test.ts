import { describe, it, expect } from "vitest";
import { normalizeBooleanFlags } from "../cli-meta.js";

describe("normalizeBooleanFlags", () => {
	const baseFlags = {
		help: false,
		spec: undefined,
		specs: undefined,
		all: false,
		iterations: undefined,
		verbose: false,
		transcript: false,
		cli: undefined,
		planCli: undefined,
		planModel: undefined,
		buildCli: undefined,
		buildModel: undefined,
		specsDir: undefined,
		session: undefined,
		force: false,
	};

	it("sets transcript to undefined when not passed", () => {
		const result = normalizeBooleanFlags(baseFlags, ["plan", "--spec=foo"]);
		expect(result.transcript).toBeUndefined();
	});

	it("preserves transcript as true when --transcript is passed", () => {
		const flags = { ...baseFlags, transcript: true };
		const result = normalizeBooleanFlags(flags, ["plan", "--transcript"]);
		expect(result.transcript).toBe(true);
	});

	it("preserves transcript as false when --no-transcript is passed", () => {
		const result = normalizeBooleanFlags(baseFlags, [
			"plan",
			"--no-transcript",
		]);
		expect(result.transcript).toBe(false);
	});

	it("preserves transcript when --transcript=true is passed", () => {
		const flags = { ...baseFlags, transcript: true };
		const result = normalizeBooleanFlags(flags, [
			"plan",
			"--transcript=true",
		]);
		expect(result.transcript).toBe(true);
	});

	it("preserves transcript when --transcript=false is passed", () => {
		const result = normalizeBooleanFlags(baseFlags, [
			"plan",
			"--transcript=false",
		]);
		expect(result.transcript).toBe(false);
	});

	it("sets transcript to undefined when after -- separator", () => {
		const result = normalizeBooleanFlags(baseFlags, [
			"plan",
			"--",
			"--transcript",
		]);
		expect(result.transcript).toBeUndefined();
	});

	it("does not modify verbose (has explicit default)", () => {
		const result = normalizeBooleanFlags(baseFlags, ["plan", "--verbose"]);
		expect(result.verbose).toBe(false);
	});

	it("does not modify flags with explicit defaults", () => {
		const result = normalizeBooleanFlags(baseFlags, ["plan"]);
		expect(result.help).toBe(false);
		expect(result.all).toBe(false);
		expect(result.verbose).toBe(false);
		expect(result.force).toBe(false);
	});
});
