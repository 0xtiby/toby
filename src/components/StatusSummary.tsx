import React from "react";
import { Text } from "ink";
import type { ProjectStats } from "../lib/stats.js";

export interface StatusSummaryProps {
	stats: ProjectStats | null;
}

export default function StatusSummary({ stats }: StatusSummaryProps) {
	if (stats === null) {
		return null;
	}

	return (
		<Text>
			<Text dimColor>Specs: </Text>
			<Text>{stats.totalSpecs}</Text>
			<Text dimColor> · Planned: </Text>
			<Text>{stats.planned}</Text>
			<Text dimColor> · Built: </Text>
			<Text>{stats.done}</Text>
			<Text dimColor> | Iterations: </Text>
			<Text>{stats.totalIterations}</Text>
		</Text>
	);
}
