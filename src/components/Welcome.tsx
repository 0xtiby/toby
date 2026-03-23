import React, { useState, useEffect } from "react";
import { Box, useApp } from "ink";
import Mascot from "./Mascot.js";
import MainMenu from "./MainMenu.js";
import Plan from "../commands/plan.js";
import Build from "../commands/build.js";
import Status from "../commands/status.js";
import { ConfigEditor } from "../commands/config.js";

export interface WelcomeProps {
	version: string;
}

export default function Welcome({ version }: WelcomeProps) {
	const { exit } = useApp();
	const [selectedCommand, setSelectedCommand] = useState<string | null>(null);

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
	if (selectedCommand === "status") {
		return <Status version={version} />;
	}
	if (selectedCommand === "config") {
		return <ConfigEditor version={version} />;
	}

	return (
		<Box flexDirection="column" gap={1}>
			<Mascot version={version} />
			<MainMenu onSelect={setSelectedCommand} />
		</Box>
	);
}
