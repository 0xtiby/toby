import React from "react";
import { Text } from "ink";

export interface PlanFlags {
	spec?: string;
	all: boolean;
	iterations?: number;
	verbose: boolean;
	cli?: string;
}

export default function Plan({ spec, all, iterations, verbose, cli }: PlanFlags) {
	const parts = ["toby plan"];
	if (spec) parts.push(`--spec=${spec}`);
	if (all) parts.push("--all");
	if (iterations !== undefined) parts.push(`--iterations=${iterations}`);
	if (verbose) parts.push("--verbose");
	if (cli) parts.push(`--cli=${cli}`);

	return <Text>{parts.join(" ")} — not yet implemented</Text>;
}
