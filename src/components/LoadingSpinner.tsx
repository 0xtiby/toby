import React from "react";
import { Text, Box } from "ink";
import Spinner from "ink-spinner";

export function LoadingSpinner({ message = "Loading..." }: { message?: string }) {
	return (
		<Box>
			<Spinner type="dots" />
			<Text> {message}</Text>
		</Box>
	);
}
