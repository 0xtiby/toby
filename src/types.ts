import { z } from "zod";

// ── Config (spec 02) ──────────────────────────────────────────────

export const CLI_NAMES = ["claude", "codex", "opencode"] as const;
export type CliName = (typeof CLI_NAMES)[number];

export const CommandConfigSchema = z.object({
	cli: z.enum(CLI_NAMES).default("claude"),
	model: z.string().default("default"),
	iterations: z.number().int().positive(),
});

export const PlanConfigSchema = CommandConfigSchema.extend({
	iterations: z.number().int().positive().default(2),
});

export const BuildConfigSchema = CommandConfigSchema.extend({
	iterations: z.number().int().positive().default(10),
});

export const ConfigSchema = z.object({
	plan: PlanConfigSchema.default({}),
	build: BuildConfigSchema.default({}),
	specsDir: z.string().default("specs"),
	excludeSpecs: z.array(z.string()).default(["README.md"]),
	verbose: z.boolean().default(false),
});

export type TobyConfig = z.infer<typeof ConfigSchema>;
export type CommandConfig = z.infer<typeof CommandConfigSchema>;

// ── Spec Discovery (spec 03) ──────────────────────────────────────

export interface SpecFile {
	/** Filename without extension, e.g. "01-auth" */
	name: string;
	/** Full path to the spec markdown file */
	path: string;
	/** Raw markdown content (loaded on demand) */
	content?: string;
}

// ── PRD / Tasks (spec 04) ─────────────────────────────────────────

export const TaskStatusSchema = z.enum([
	"pending",
	"in_progress",
	"done",
	"blocked",
]);

export const TaskSchema = z.object({
	id: z.string(),
	title: z.string(),
	description: z.string(),
	acceptanceCriteria: z.array(z.string()),
	files: z.array(z.string()),
	dependencies: z.array(z.string()),
	status: TaskStatusSchema.default("pending"),
	priority: z.number().int().positive(),
});

export const PrdSchema = z
	.object({
		spec: z.string(),
		createdAt: z.string().datetime(),
		tasks: z.array(TaskSchema),
	})
	.refine(
		(prd) => {
			const ids = prd.tasks.map((t) => t.id);
			return new Set(ids).size === ids.length;
		},
		{ message: "Task IDs must be unique" },
	);

export type PRDData = z.infer<typeof PrdSchema>;
export type Task = z.infer<typeof TaskSchema>;
export type TaskStatus = z.infer<typeof TaskStatusSchema>;

// ── Status (spec 04) ──────────────────────────────────────────────

export const IterationSchema = z.object({
	type: z.enum(["plan", "build"]),
	iteration: z.number().int().positive(),
	sessionId: z.string().nullable(),
	cli: z.string(),
	model: z.string(),
	startedAt: z.string().datetime(),
	completedAt: z.string().datetime().nullable(),
	exitCode: z.number().int().nullable(),
	taskCompleted: z.string().nullable(),
	tokensUsed: z.number().int().nullable(),
});

export const SpecStatusEntrySchema = z.object({
	status: z.enum(["pending", "planned", "building", "done"]),
	plannedAt: z.string().datetime().nullable(),
	iterations: z.array(IterationSchema),
});

export const StatusSchema = z.object({
	specs: z.record(z.string(), SpecStatusEntrySchema),
});

export type StatusData = z.infer<typeof StatusSchema>;
export type Iteration = z.infer<typeof IterationSchema>;
export type SpecStatusEntry = z.infer<typeof SpecStatusEntrySchema>;

// ── Prompt Template (spec 05) ─────────────────────────────────────

export interface PromptTemplate {
	/** Resolved file path of the prompt */
	path: string;
	/** Raw template content before substitution */
	content: string;
}

export type PromptName = "PROMPT_PLAN" | "PROMPT_BUILD" | "PROMPT_BUILD_ALL";

export interface TemplateVars {
	SPEC_NAME: string;
	ITERATION: string;
	BRANCH: string;
	WORKTREE: string;
	EPIC_NAME: string;
	IS_LAST_SPEC: string;
	PRD_PATH: string;
	SPEC_CONTENT: string;
}
