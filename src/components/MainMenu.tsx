import React from "react";
import { Text, Box } from "ink";
import SelectInput from "ink-select-input";

export interface MainMenuProps {
	onSelect: (command: string) => void;
}

const MENU_ITEMS = [
	{ label: "plan", value: "plan", description: "Plan specs with AI loop engine" },
	{ label: "build", value: "build", description: "Build tasks one-per-spawn with AI" },
	{ label: "resume", value: "resume", description: "Resume an interrupted build session" },
	{ label: "status", value: "status", description: "Show project status" },
	{ label: "config", value: "config", description: "Manage configuration" },
];

interface MenuItemProps {
	isSelected?: boolean;
	label: string;
	value: string;
	description?: string;
}

function MenuItem({ isSelected = false, label, description }: MenuItemProps) {
	return (
		<Box>
			<Text color={isSelected ? "blue" : undefined}>
				{label.padEnd(10)}
			</Text>
			{description && (
				<Text dimColor>— {description}</Text>
			)}
		</Box>
	);
}

export default function MainMenu({ onSelect }: MainMenuProps) {
	return (
		<Box flexDirection="column">
			<SelectInput
				items={MENU_ITEMS}
				itemComponent={MenuItem}
				onSelect={(item) => onSelect(item.value)}
			/>
		</Box>
	);
}
