export async function withSigint<T>(fn: (signal: AbortSignal) => Promise<T>): Promise<T> {
	const abortController = new AbortController();
	const onSigint = () => abortController.abort();
	process.on("SIGINT", onSigint);
	try {
		return await fn(abortController.signal);
	} finally {
		process.off("SIGINT", onSigint);
	}
}
