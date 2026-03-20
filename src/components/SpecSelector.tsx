import React from "react";
import { Box, Text } from "ink";
import SelectInput from "ink-select-input";
import type { Spec } from "../lib/specs.js";

interface SpecSelectorProps {
	specs: Spec[];
	onSelect: (spec: Spec) => void;
	title?: string;
}

export default function SpecSelector({ specs, onSelect, title = "Select a spec to plan:" }: SpecSelectorProps) {
	if (specs.length === 0) {
		return <Text color="red">No specs found.</Text>;
	}

	const items = specs.map((spec) => ({
		label: `${spec.name}  [${spec.status}]`,
		value: spec.name,
	}));

	function handleSelect(item: { label: string; value: string }) {
		const spec = specs.find((s) => s.name === item.value);
		if (spec) onSelect(spec);
	}

	return (
		<Box flexDirection="column">
			<Text bold>{title}</Text>
			<SelectInput items={items} onSelect={handleSelect} />
		</Box>
	);
}
