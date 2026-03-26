import React, { useState, useEffect, useMemo } from "react";
import { Box, Text, useApp, useStdout } from "ink";
import HamsterWheel from "./hamster/HamsterWheel.js";
import InfoPanel from "./InfoPanel.js";
import MainMenu from "./MainMenu.js";
import Plan from "../commands/plan.js";
import Build from "../commands/build.js";
import Status from "../commands/status.js";
import Resume from "../commands/resume.js";
import { ConfigEditor } from "../commands/config.js";
import { computeProjectStats } from "../lib/stats.js";
import { formatTokens } from "./InfoPanel.js";

const NARROW_THRESHOLD = 60;

export interface WelcomeProps {
	version: string;
}

export default function Welcome({ version }: WelcomeProps) {
	const { exit } = useApp();
	const { stdout } = useStdout();
	const [selectedCommand, setSelectedCommand] = useState<string | null>(null);
	const stats = useMemo(() => computeProjectStats(), []);
	const isNarrow = (stdout.columns ?? 80) < NARROW_THRESHOLD;

	// Status renders synchronously (no async work / no own exit lifecycle),
	// so we defer exit() to the next tick to let Ink flush the final render.
	useEffect(() => {
		if (selectedCommand === "status") {
			const timer = setTimeout(() => exit(), 0);
			return () => clearTimeout(timer);
		}
	}, [selectedCommand, exit]);

	if (selectedCommand === "plan") {
		return <Plan />;
	}
	if (selectedCommand === "build") {
		return <Build />;
	}
	if (selectedCommand === "resume") {
		return <Resume />;
	}
	if (selectedCommand === "status") {
		return <Status version={version} />;
	}
	if (selectedCommand === "config") {
		return <ConfigEditor version={version} />;
	}

	return (
		<Box flexDirection="column" gap={1}>
			{isNarrow ? (
				<Box flexDirection="column">
					<Text bold color="#f0a030">
						🐹 toby v{version}
					</Text>
					{stats !== null && (
						<Text>
							<Text dimColor>Specs: </Text>
							<Text>{stats.totalSpecs}</Text>
							<Text dimColor> · Planned: </Text>
							<Text>{stats.planned}</Text>
							<Text dimColor> · Done: </Text>
							<Text>{stats.done}</Text>
							<Text dimColor> · Tokens: </Text>
							<Text>{formatTokens(stats.totalTokens)}</Text>
						</Text>
					)}
				</Box>
			) : (
				<Box flexDirection="row" gap={2}>
					<HamsterWheel />
					<InfoPanel version={version} stats={stats} />
				</Box>
			)}
			<MainMenu onSelect={setSelectedCommand} />
		</Box>
	);
}
