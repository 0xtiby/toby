import React from "react";
import { Text, Box } from "ink";

export interface ConfigFlags {
	subcommand?: string;
	configKey?: string;
	value?: string;
	version: string;
}

function UnknownSubcommand({ subcommand }: { subcommand: string }) {
	return (
		<Text color="red">
			{`Unknown config subcommand: ${subcommand}\nUsage: toby config [get <key> | set <key> <value>]`}
		</Text>
	);
}

export default function Config({
	subcommand,
	configKey,
	value,
	version,
}: ConfigFlags) {
	if (subcommand && subcommand !== "get" && subcommand !== "set") {
		return (
			<Box flexDirection="column">
				<Text>{`toby v${version}`}</Text>
				<Text>{""}</Text>
				<UnknownSubcommand subcommand={subcommand} />
			</Box>
		);
	}

	return (
		<Box flexDirection="column">
			<Text>{`toby v${version}`}</Text>
			<Text>{""}</Text>
			{subcommand === "get" && configKey ? (
				<Text>{`toby config get ${configKey} — not yet implemented`}</Text>
			) : subcommand === "set" && configKey ? (
				<Text>{`toby config set ${configKey} ${value ?? ""} — not yet implemented`}</Text>
			) : (
				<Text>toby config — not yet implemented</Text>
			)}
		</Box>
	);
}
