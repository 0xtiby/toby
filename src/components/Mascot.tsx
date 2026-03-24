import React from "react";
import { Text, Box } from "ink";

export interface MascotProps {
	version: string;
}

export default function Mascot({ version }: MascotProps) {
	return (
		<Box flexDirection="column">
			<Text color="cyan">{"  ┌─────┐"}</Text>
			<Text color="cyan">{"  │ ● ● │"}</Text>
			<Box>
				<Text color="cyan">{"  │  ▬  │"}</Text>
				<Text color="cyan">{"  toby v"}{version}</Text>
			</Box>
			<Text color="cyan">{"  └─┬─┬─┘"}</Text>
			<Text color="cyan">{"    │ │"}</Text>
		</Box>
	);
}
