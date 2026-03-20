import React from "react";
import { Text, Box } from "ink";
import type { CliEvent } from "@0xtiby/spawner";

export interface StreamOutputProps {
	events: CliEvent[];
	verbose?: boolean;
	maxLines?: number;
}

/**
 * Filter events based on verbose mode.
 * Default: only text events. Verbose: all events.
 */
export function filterEvents(events: CliEvent[], verbose: boolean): CliEvent[] {
	if (verbose) return events;
	return events.filter((e) => e.type === "text");
}

/**
 * Format a single event for display.
 */
export function formatEvent(event: CliEvent): string {
	switch (event.type) {
		case "text":
			return event.content ?? "";
		case "tool_use":
			return `⚙ ${event.tool?.name ?? "tool"}`;
		case "tool_result":
			return `  ↳ ${(event.content ?? "").slice(0, 120)}`;
		case "error":
			return `✗ ${event.content ?? "error"}`;
		case "system":
			return `[system] ${event.content ?? ""}`;
		default:
			return event.content ?? "";
	}
}

function colorForType(type: string): string | undefined {
	switch (type) {
		case "tool_use":
			return "cyan";
		case "tool_result":
			return "gray";
		case "error":
			return "red";
		case "system":
			return "yellow";
		default:
			return undefined;
	}
}

export default function StreamOutput({ events, verbose = false, maxLines = 20 }: StreamOutputProps) {
	const filtered = filterEvents(events, verbose);
	const visible = filtered.slice(-maxLines);

	if (visible.length === 0) return null;

	return (
		<Box flexDirection="column">
			{visible.map((event, i) => (
				<Text key={i} color={colorForType(event.type)}>
					{formatEvent(event)}
				</Text>
			))}
		</Box>
	);
}
