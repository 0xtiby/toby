import ora from "ora";

export function createSpinner(text: string) {
	return ora({ text, isSilent: !process.stdout.isTTY });
}

export async function withSpinner<T>(
	text: string,
	fn: () => Promise<T>,
): Promise<T> {
	const spinner = createSpinner(text).start();
	try {
		const result = await fn();
		spinner.succeed();
		return result;
	} catch (err) {
		spinner.fail();
		throw err;
	}
}
