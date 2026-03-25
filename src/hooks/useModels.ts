import { useState, useEffect } from "react";
import { listModels } from "@0xtiby/spawner";
import type { CliName } from "../types.js";

export interface ModelItem {
	label: string;
	value: string;
}

export interface UseModelsResult {
	items: ModelItem[];
	loading: boolean;
}

export const DEFAULT_ITEM: ModelItem = { label: "default", value: "default" };

export function useModels(cli: CliName): UseModelsResult {
	const [items, setItems] = useState<ModelItem[]>([DEFAULT_ITEM]);
	const [loading, setLoading] = useState(true);

	useEffect(() => {
		let cancelled = false;
		setLoading(true);

		listModels({ cli, fallback: true })
			.then((models) => {
				if (!cancelled) {
					const mapped = models.map((m) => ({
						label: `${m.name} (${m.id})`,
						value: m.id,
					}));
					setItems([DEFAULT_ITEM, ...mapped]);
				}
			})
			.catch(() => {
				if (!cancelled) {
					setItems([DEFAULT_ITEM]);
				}
			})
			.finally(() => {
				if (!cancelled) setLoading(false);
			});

		return () => { cancelled = true; };
	}, [cli]);

	return { items, loading };
}
