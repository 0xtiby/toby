import React from "react";
import { describe, it, expect } from "vitest";
import { render } from "ink-testing-library";
import Init from "./init.js";

describe("Init", () => {
	it("displays version header", () => {
		const { lastFrame } = render(<Init version="0.1.0" />);
		expect(lastFrame()).toContain("toby v0.1.0");
	});

	it("shows not-yet-implemented message", () => {
		const { lastFrame } = render(<Init version="0.1.0" />);
		expect(lastFrame()).toContain("toby init");
	});
});
