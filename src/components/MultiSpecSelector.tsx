import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import type { Spec } from "../lib/specs.js";

interface MultiSpecSelectorProps {
	specs: Spec[];
	onConfirm: (selected: Spec[]) => void;
	title?: string;
}

export default function MultiSpecSelector({
	specs,
	onConfirm,
	title = "Select specs to plan:",
}: MultiSpecSelectorProps) {
	// cursor=0 is "Select All", cursor=1..N are individual specs
	const [cursor, setCursor] = useState(0);
	const [selected, setSelected] = useState<Set<string>>(new Set());
	const [warning, setWarning] = useState("");

	const allSelected = specs.length > 0 && specs.every((s) => selected.has(s.name));

	useInput((input, key) => {
		if (specs.length === 0) return;

		if (key.upArrow) {
			setCursor((c) => (c <= 0 ? specs.length : c - 1));
			setWarning("");
		} else if (key.downArrow) {
			setCursor((c) => (c >= specs.length ? 0 : c + 1));
			setWarning("");
		} else if (input === " ") {
			setWarning("");
			if (cursor === 0) {
				// Toggle Select All
				if (allSelected) {
					setSelected(new Set());
				} else {
					setSelected(new Set(specs.map((s) => s.name)));
				}
			} else {
				const spec = specs[cursor - 1];
				setSelected((prev) => {
					const next = new Set(prev);
					if (next.has(spec.name)) {
						next.delete(spec.name);
					} else {
						next.add(spec.name);
					}
					return next;
				});
			}
		} else if (key.return) {
			const selectedSpecs = specs.filter((s) => selected.has(s.name));
			if (selectedSpecs.length === 0) {
				setWarning("Please select at least one spec");
				return;
			}
			onConfirm(selectedSpecs);
		}
	});

	if (specs.length === 0) {
		return <Text color="red">No specs found.</Text>;
	}

	return (
		<Box flexDirection="column">
			<Text bold>{title}</Text>
			{/* Select All */}
			<Text>
				{cursor === 0 ? "❯ " : "  "}
				{allSelected ? "◉" : "○"} Select All
			</Text>
			<Text dimColor>{"  ──────────────"}</Text>
			{/* Individual specs */}
			{specs.map((spec, i) => {
				const isHighlighted = cursor === i + 1;
				const isSelected = selected.has(spec.name);
				return (
					<Text key={spec.name}>
						{isHighlighted ? "❯ " : "  "}
						{isSelected ? "◉" : "○"} {spec.name}  [{spec.status}]
					</Text>
				);
			})}
			{warning && <Text color="yellow">{warning}</Text>}
		</Box>
	);
}
