import React from "react";
import { Text, Box } from "ink";

export interface InitFlags {
	version: string;
}

export default function Init({ version }: InitFlags) {
	return (
		<Box flexDirection="column">
			<Text>{`toby v${version}`}</Text>
			<Text>{""}</Text>
			<Text>toby init — not yet implemented</Text>
		</Box>
	);
}
