import { describe, it, expect } from "vitest";
import { substitute } from "./template.js";

describe("substitute", () => {
	it("replaces a single variable", () => {
		expect(substitute("Hello {{NAME}}", { NAME: "world" } as any)).toBe(
			"Hello world",
		);
	});

	it("replaces multiple variables", () => {
		expect(substitute("{{A}} and {{B}}", { A: "1", B: "2" } as any)).toBe(
			"1 and 2",
		);
	});

	it("leaves unknown variables as-is", () => {
		expect(substitute("{{UNKNOWN}}", {})).toBe("{{UNKNOWN}}");
	});

	it("returns template unchanged when no variables present", () => {
		expect(substitute("no vars here", { FOO: "bar" } as any)).toBe(
			"no vars here",
		);
	});

	it("replaces TemplateVars fields correctly", () => {
		expect(
			substitute("{{SPEC_NAME}} iter {{ITERATION}}", {
				SPEC_NAME: "01-auth",
				ITERATION: "2",
			}),
		).toBe("01-auth iter 2");
	});

	it("handles mixed known and unknown variables", () => {
		expect(
			substitute("{{SPEC_NAME}} {{MISSING}}", { SPEC_NAME: "test" }),
		).toBe("test {{MISSING}}");
	});

	it("replaces multiple occurrences of the same variable", () => {
		expect(
			substitute("{{SPEC_NAME}} and {{SPEC_NAME}}", {
				SPEC_NAME: "auth",
			}),
		).toBe("auth and auth");
	});
});
