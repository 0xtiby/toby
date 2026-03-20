export class AbortError extends Error {
	specName: string;
	completedIterations: number;
	constructor(specName: string, completedIterations: number) {
		super(`Interrupted for ${specName} after ${completedIterations} iteration(s)`);
		this.name = "AbortError";
		this.specName = specName;
		this.completedIterations = completedIterations;
	}
}
