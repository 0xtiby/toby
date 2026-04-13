import { z } from "zod";

// ── Config (spec 02) ──────────────────────────────────────────────

export const CLI_NAMES = ["claude", "codex", "opencode"] as const;
export type CliName = (typeof CLI_NAMES)[number];

export const TRACKER_NAMES = ["prd-json", "github", "beads"] as const;
export type TrackerName = (typeof TRACKER_NAMES)[number];

export function isValidTracker(value: string): value is TrackerName {
	return (TRACKER_NAMES as readonly string[]).includes(value);
}

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

export const SyncConfigSchema = z.object({
	cli: z.enum(CLI_NAMES).optional(),
	model: z.string().optional(),
});

export const ConfigSchema = z.object({
	plan: PlanConfigSchema.default({}),
	build: BuildConfigSchema.default({}),
	sync: SyncConfigSchema.optional(),
	specsDir: z.string().default("specs"),
	excludeSpecs: z.array(z.string()).default(["README.md"]),
	verbose: z.boolean().default(false),
	transcript: z.boolean().default(false),
	templateVars: z.record(z.string(), z.string()).default({}),
});

export type TobyConfig = z.infer<typeof ConfigSchema>;
export type CommandConfig = z.infer<typeof CommandConfigSchema>;
export type SyncConfig = z.infer<typeof SyncConfigSchema>;

// ── Spec Discovery (spec 03) ──────────────────────────────────────

export interface SpecFile {
	/** Filename without extension, e.g. "01-auth" */
	name: string;
	/** Full path to the spec markdown file */
	path: string;
	/** Raw markdown content (loaded on demand) */
	content?: string;
}

// ── Status (spec 04) ──────────────────────────────────────────────

export const IterationStateSchema = z.enum([
	"in_progress",
	"complete",
	"failed",
]);
export type IterationState = z.infer<typeof IterationStateSchema>;

export const IterationSchema = z.object({
	type: z.enum(["plan", "build"]),
	iteration: z.number().int().positive(),
	sessionId: z.string().nullable(),
	state: IterationStateSchema.default("in_progress"),
	cli: z.string(),
	model: z.string(),
	startedAt: z.string().datetime(),
	completedAt: z.string().datetime().nullable(),
	exitCode: z.number().int().nullable(),
	taskCompleted: z.string().nullable(),
	tokensUsed: z.number().int().nullable(),
	inputTokens: z.number().int().nullable().default(null),
	outputTokens: z.number().int().nullable().default(null),
	cost: z.number().nullable().default(null),
});

export const StopReasonSchema = z.enum([
	"sentinel",
	"max_iterations",
	"error",
	"aborted",
]);
export type StopReason = z.infer<typeof StopReasonSchema>;

export const SpecStatusEntrySchema = z.object({
	status: z.enum(["pending", "planned", "building", "done"]),
	plannedAt: z.string().datetime().nullable(),
	iterations: z.array(IterationSchema),
	stopReason: StopReasonSchema.optional(),
});

export const SessionStateSchema = z.enum(["active", "interrupted"]);
export type SessionState = z.infer<typeof SessionStateSchema>;

export const SessionSchema = z.object({
	name: z.string(),
	cli: z.string(),
	specs: z.array(z.string()),
	state: SessionStateSchema,
	startedAt: z.string().datetime(),
});
export type Session = z.infer<typeof SessionSchema>;

export const StatusSchema = z.object({
	specs: z.record(z.string(), SpecStatusEntrySchema),
	session: SessionSchema.optional(),
}).strip();

export type StatusData = z.infer<typeof StatusSchema>;
export type Iteration = z.infer<typeof IterationSchema>;
export type SpecStatusEntry = z.infer<typeof SpecStatusEntrySchema>;

// ── Prompt Template (spec 05) ─────────────────────────────────────

export type PromptName = "PROMPT_PLAN" | "PROMPT_BUILD";

export type TemplateVars = Record<string, string>;

export interface LoadPromptOptions {
	cwd?: string;
}

export interface ComputeCliVarsOptions {
	specName: string;
	iteration: number;
	specIndex: number;
	specCount: number;
	session: string;
	specs: string[];
	specsDir: string;
}

// ── CLI Command Flags ────────────────────────────────────────────

export interface CommandFlags {
	spec?: string;
	all: boolean;
	iterations?: number;
	verbose: boolean;
	transcript?: boolean;
	cli?: string;
	session?: string;
}
