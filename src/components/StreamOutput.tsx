import React from "react";
import { Text } from "ink";

interface StreamOutputProps {
	lines: string[];
	color?: string;
}

export default function StreamOutput({ lines, color }: StreamOutputProps) {
	return (
		<Text color={color}>
			{lines.join("\n")}
		</Text>
	);
}
