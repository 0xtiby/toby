import React from "react";
import { describe, it, expect } from "vitest";
import { render } from "ink-testing-library";
import Status from "./status.js";

describe("Status", () => {
	it("displays version header", () => {
		const { lastFrame } = render(<Status version="0.1.0" />);
		expect(lastFrame()).toContain("toby v0.1.0");
	});

	it("shows generic message without --spec", () => {
		const { lastFrame } = render(<Status version="0.1.0" />);
		expect(lastFrame()).toContain("toby status");
	});

	it("passes --spec flag through", () => {
		const { lastFrame } = render(<Status version="0.1.0" spec="auth" />);
		expect(lastFrame()).toContain("--spec=auth");
	});
});
