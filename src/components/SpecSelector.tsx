import React from "react";
import { Box, Text } from "ink";
import SelectInput from "ink-select-input";
import type { Spec } from "../lib/specs.js";

interface SpecSelectorProps {
	specs: Spec[];
	onSelect: (spec: Spec) => void;
}

const STATUS_COLORS: Record<string, string> = {
	pending: "yellow",
	planned: "cyan",
	building: "blue",
	done: "green",
};

export default function SpecSelector({ specs, onSelect }: SpecSelectorProps) {
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
			<Text bold>Select a spec to plan:</Text>
			<SelectInput items={items} onSelect={handleSelect} />
		</Box>
	);
}
