import React from "react";
import { describe, it, expect } from "vitest";
import { render } from "ink-testing-library";
import Config from "./config.js";

describe("Config", () => {
	it("displays version header", () => {
		const { lastFrame } = render(<Config version="0.1.0" />);
		expect(lastFrame()).toContain("toby v0.1.0");
	});

	it("shows interactive mode without subcommand", () => {
		const { lastFrame } = render(<Config version="0.1.0" />);
		expect(lastFrame()).toContain("toby config");
	});

	it("routes config get with key", () => {
		const { lastFrame } = render(
			<Config version="0.1.0" subcommand="get" configKey="plan.cli" />,
		);
		expect(lastFrame()).toContain("config get plan.cli");
	});

	it("routes config set with key and value", () => {
		const { lastFrame } = render(
			<Config
				version="0.1.0"
				subcommand="set"
				configKey="build.model"
				value="opus"
			/>,
		);
		expect(lastFrame()).toContain("config set build.model opus");
	});

	it("shows error for unknown subcommand", () => {
		const { lastFrame } = render(
			<Config version="0.1.0" subcommand="badcmd" />,
		);
		expect(lastFrame()).toContain("Unknown config subcommand: badcmd");
	});
});
