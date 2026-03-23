import React from "react";
import { Text, Box } from "ink";

export interface MascotProps {
	version: string;
}

const ROBOT_LINES = [
	"  ┌─────┐",
	"  │ ● ● │",
	"  │  ▬  │",
	"  └─┬─┬─┘",
	"    │ │",
];

export default function Mascot({ version }: MascotProps) {
	return (
		<Box flexDirection="column">
			{ROBOT_LINES.map((line, i) => (
				<Box key={i}>
					<Text color="cyan">{line}</Text>
					{i === 2 && (
						<Text color="cyan">{"  toby v"}{version}</Text>
					)}
				</Box>
			))}
		</Box>
	);
}
