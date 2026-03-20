import React from "react";
import { Text } from "ink";

export interface BuildFlags {
	spec?: string;
	all: boolean;
	iterations?: number;
	verbose: boolean;
	cli?: string;
}

export default function Build(flags: BuildFlags) {
	return (
		<Text>
			{`toby build — not yet implemented (spec=${flags.spec ?? "none"}, all=${flags.all})`}
		</Text>
	);
}
