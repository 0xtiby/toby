import { listModels } from "@0xtiby/spawner";
import type { CliName } from "../types.js";

export interface CliDetection {
	installed: boolean;
	version: string | null;
	authenticated: boolean;
	binaryPath: string | null;
}

export type DetectAllResult = Record<CliName, CliDetection>;

export async function loadModelOptions(
	cli: CliName,
): Promise<{ value: string; label: string }[]> {
	try {
		const models = await listModels({ cli });
		return [
			{ value: "default", label: "default" },
			...models.map((m) => ({ value: m.id, label: `${m.name} (${m.id})` })),
		];
	} catch {
		return [{ value: "default", label: "default" }];
	}
}
