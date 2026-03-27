import * as clack from "@clack/prompts";
import type { SpecFile, SpecStatusEntry } from "../types.js";

export async function selectSpec(
	specs: SpecFile[],
	statusMap: Record<string, SpecStatusEntry>,
): Promise<SpecFile> {
	const result = await clack.select({
		message: "Select a spec",
		options: specs.map((s) => ({
			label: `${s.name} [${statusMap[s.name]?.status ?? "pending"}]`,
			value: s,
		})),
	});
	handleCancel(result);
	return result as SpecFile;
}

export async function selectSpecs(
	specs: SpecFile[],
	statusMap: Record<string, SpecStatusEntry>,
): Promise<SpecFile[]> {
	const result = await clack.multiselect({
		message: "Select specs",
		options: specs.map((s) => ({
			label: `${s.name} [${statusMap[s.name]?.status ?? "pending"}]`,
			value: s,
		})),
	});
	handleCancel(result);
	return result as SpecFile[];
}

export async function confirmAction(message: string): Promise<boolean> {
	const result = await clack.confirm({ message });
	handleCancel(result);
	return result as boolean;
}

export function handleCancel(value: unknown): void {
	if (clack.isCancel(value)) {
		clack.cancel("Operation cancelled.");
		process.exit(0);
	}
}
