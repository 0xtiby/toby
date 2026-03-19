import React from "react";
import { Text } from "ink";
import type { SpecFile } from "../types.js";

interface SpecSelectorProps {
	specs: SpecFile[];
	onSelect: (spec: SpecFile) => void;
}

export default function SpecSelector({ specs, onSelect: _onSelect }: SpecSelectorProps) {
	return (
		<Text>
			{specs.length === 0
				? "No specs found."
				: `${specs.length} spec(s) available`}
		</Text>
	);
}
