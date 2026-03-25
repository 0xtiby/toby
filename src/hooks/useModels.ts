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
	error: string | null;
}

export interface UseModelsOptions {
	enabled?: boolean;
}

export const DEFAULT_ITEM: ModelItem = { label: "default", value: "default" };

export function useModels(cli: CliName, options: UseModelsOptions = {}): UseModelsResult {
	const { enabled = true } = options;
	const [items, setItems] = useState<ModelItem[]>([DEFAULT_ITEM]);
	const [loading, setLoading] = useState(enabled);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		if (!enabled) {
			setLoading(false);
			return;
		}

		let cancelled = false;
		setLoading(true);
		setError(null);

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
			.catch((err) => {
				if (!cancelled) {
					const message = err instanceof Error ? err.message : String(err);
					console.warn(`Failed to load models for ${cli}: ${message}`);
					setError(message);
					setItems([DEFAULT_ITEM]);
				}
			})
			.finally(() => {
				if (!cancelled) setLoading(false);
			});

		return () => { cancelled = true; };
	}, [cli, enabled]);

	return { items, loading, error };
}
