import React from "react";
import { Text } from "ink";

interface StatusBarProps {
	specName: string;
	iteration: number;
	maxIterations: number;
	phase: "plan" | "build";
}

export default function StatusBar({ specName, iteration, maxIterations, phase }: StatusBarProps) {
	return (
		<Text dimColor>
			{`[${phase}] ${specName} — iteration ${iteration}/${maxIterations}`}
		</Text>
	);
}
