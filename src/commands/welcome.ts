import * as clack from "@clack/prompts";
import { banner } from "../ui/format.js";
import { computeProjectStats } from "../lib/stats.js";
import { isTTY } from "../ui/tty.js";

const MENU_ITEMS = [
	{ value: "plan", label: "plan", hint: "Plan specs with AI loop engine" },
	{ value: "build", label: "build", hint: "Build tasks one-per-spawn with AI" },
	{ value: "resume", label: "resume", hint: "Resume an interrupted build session" },
	{ value: "status", label: "status", hint: "Show project status" },
	{ value: "config", label: "config", hint: "Manage configuration" },
];

export async function runWelcome(version: string): Promise<void> {
	if (!isTTY()) {
		printHelp(version);
		return;
	}

	const stats = computeProjectStats();
	console.log(banner(version, stats));
	console.log("");

	const selected = await clack.select({
		message: "What would you like to do?",
		options: MENU_ITEMS,
	});

	if (clack.isCancel(selected)) {
		clack.cancel("Goodbye.");
		return;
	}

	await dispatch(selected as string, version);
}

function printHelp(version: string): void {
	console.log(`toby v${version} — AI-assisted development loop engine`);
	console.log("");
	console.log("Commands:");
	console.log("  plan     Plan specs with AI loop engine");
	console.log("  build    Build tasks one-per-spawn with AI");
	console.log("  resume   Resume an interrupted build session");
	console.log("  status   Show project status");
	console.log("  config   Manage configuration");
	console.log("  init     Initialize a new project");
	console.log("  clean    Delete transcript files");
	console.log("");
	console.log("Run toby <command> --help for usage details.");
}

async function dispatch(command: string, version: string): Promise<void> {
	switch (command) {
		case "plan": {
			const { runPlan } = await import("./plan.js");
			await runPlan({});
			break;
		}
		case "build": {
			const { runBuild } = await import("./build.js");
			await runBuild({});
			break;
		}
		case "resume": {
			const { runResume } = await import("./resume.js");
			await runResume({});
			break;
		}
		case "status": {
			const { runStatus } = await import("./status.js");
			await runStatus({ version });
			break;
		}
		case "config": {
			const { runConfig } = await import("./config.js");
			await runConfig({ version });
			break;
		}
	}
}
