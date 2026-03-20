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

	it("handles variable value containing {{ characters", () => {
		expect(
			substitute("Result: {{SPEC_NAME}}", {
				SPEC_NAME: "has {{braces}} inside",
			}),
		).toBe("Result: has {{braces}} inside");
	});

	it("returns empty string for empty template", () => {
		expect(substitute("", { SPEC_NAME: "test" })).toBe("");
	});

	it("replaces placeholder with empty string when value is empty", () => {
		expect(substitute("before {{SPEC_NAME}} after", { SPEC_NAME: "" })).toBe(
			"before  after",
		);
	});

	it("substitutes all TemplateVars fields correctly", () => {
		const vars: import("../types.js").TemplateVars = {
			SPEC_NAME: "01-auth",
			ITERATION: "3",
			BRANCH: "feat/auth",
			WORKTREE: ".worktrees/feat/auth",
			EPIC_NAME: "authentication",
			IS_LAST_SPEC: "true",
			PRD_PATH: ".toby/prd/01-auth.json",
			SPEC_CONTENT: "# Auth Spec",
		};
		const template =
			"{{SPEC_NAME}}|{{ITERATION}}|{{BRANCH}}|{{WORKTREE}}|{{EPIC_NAME}}|{{IS_LAST_SPEC}}|{{PRD_PATH}}|{{SPEC_CONTENT}}";
		expect(substitute(template, vars)).toBe(
			"01-auth|3|feat/auth|.worktrees/feat/auth|authentication|true|.toby/prd/01-auth.json|# Auth Spec",
		);
	});
});
