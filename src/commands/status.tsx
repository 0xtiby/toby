import React from "react";
import { Text, Box } from "ink";

export interface StatusFlags {
	spec?: string;
	version: string;
}

export default function Status({ spec, version }: StatusFlags) {
	return (
		<Box flexDirection="column">
			<Text>{`toby v${version}`}</Text>
			<Text>{""}</Text>
			{spec ? (
				<Text>{`toby status --spec=${spec} — not yet implemented`}</Text>
			) : (
				<Text>toby status — not yet implemented</Text>
			)}
		</Box>
	);
}
