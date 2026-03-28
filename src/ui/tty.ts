export function isTTY(): boolean {
	return Boolean(process.stdout.isTTY);
}
