import React from "react";
import { Box, Text } from "ink";
import type { ProjectStats } from "../lib/stats.js";

export interface InfoPanelProps {
	version: string;
	stats: ProjectStats | null;
}

export const formatTokens = (n: number): string => new Intl.NumberFormat().format(n);

function StatRow({ label, value }: { label: string; value: number | string }) {
	return (
		<Box>
			<Text dimColor>{String(label).padStart(9)}  </Text>
			<Text>{value}</Text>
		</Box>
	);
}

export default function InfoPanel({ version, stats }: InfoPanelProps) {
	return (
		<Box flexDirection="column">
			<Text bold color="#f0a030">
				toby v{version}
			</Text>
			{stats !== null && (
				<Box flexDirection="column" marginTop={1}>
					<StatRow label="Specs" value={stats.totalSpecs} />
					<StatRow label="Planned" value={stats.planned} />
					<StatRow label="Done" value={stats.done} />
					<StatRow label="Tokens" value={formatTokens(stats.totalTokens)} />
				</Box>
			)}
		</Box>
	);
}
