import { z } from "zod";

// ── Auth ──

export const loginSchema = z.object({
  email: z.string().min(1, "Email is required"),
  password: z.string().min(1, "Password is required"),
});

export const changePasswordSchema = z.object({
  current_password: z.string().min(1, "Current password is required"),
  new_password: z.string().min(6, "New password must be at least 6 characters"),
});

export const updateNameSchema = z.object({
  name: z.string().min(1, "Name is required").transform((v) => v.trim()).pipe(z.string().min(1, "Name is required")),
});

// ── Setup ──

export const setupCompleteSchema = z.object({
  name: z.string().min(1, "Name is required"),
  email: z.string().regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, "Invalid email format").optional().nullable(),
  password: z.string().min(6, "Password must be at least 6 characters").optional().nullable(),
  projects_dir: z.string().refine((v) => !v || v.startsWith("/"), "Projects directory must be an absolute path").optional().nullable(),
  git_name: z.string().optional().nullable(),
  git_email: z.string().optional().nullable(),
  generate_ssh_key: z.boolean().optional(),
});

// ── Invite Accept ──

export const inviteAcceptSchema = z.object({
  name: z.string().min(1, "Name is required"),
  password: z.string().min(6, "Password must be at least 6 characters"),
});

// ── Apps ──

export const createAppSchema = z.object({
  name: z.string().min(1, "App name is required").transform((v) => v.trim()).pipe(z.string().min(1, "App name is required")),
  description: z.string().optional().nullable(),
});

export const importAppSchema = z.object({
  github_url: z.string().min(1, "github_url is required").transform((v) => v.trim()).pipe(z.string().min(1, "github_url is required")),
  local_path: z.string().optional(),
});

// ── Tasks ──

export const createTaskSchema = z.object({
  title: z.string().trim().min(1, "Title is required").max(200, "Title is too long"),
  description: z.string().trim().max(20000, "Description is too long").optional().default(""),
  status: z.enum(["todo", "in_progress", "done"]).optional().default("todo"),
  assigned_to: z.number().int().positive().nullable().optional(),
});

export const updateTaskSchema = z.object({
  title: z.string().trim().min(1, "Title is required").max(200, "Title is too long").optional(),
  description: z.string().trim().max(20000, "Description is too long").optional(),
  status: z.enum(["todo", "in_progress", "done"]).optional(),
  assigned_to: z.number().int().positive().nullable().optional(),
  position: z.number().int().min(0).optional(),
});

// ── Admin: Invitations ──

export const createInvitationSchema = z.object({
  email: z.string().min(1, "Email is required").includes("@", { message: "Valid email is required" }),
});

// ── Admin: Users ──

export const patchUserSchema = z.union([
  z.object({ restore: z.literal(true) }),
  z.object({ role: z.enum(["admin", "member"], { message: "Role must be 'admin' or 'member'" }) }),
]);

export const adminResetUserPasswordSchema = z.object({
  new_password: z.string().min(6, "New password must be at least 6 characters"),
});

// ── Settings ──

const allowedSettingKeys = ["projects_dir", "github_token"] as const;

export const createSettingSchema = z.object({
  key: z.enum(allowedSettingKeys, { message: `Only ${allowedSettingKeys.join(", ")} settings can be modified` }),
  value: z.string({ message: "value is required" }),
}).refine(
  (data) => data.key !== "projects_dir" || data.value.startsWith("/"),
  { message: "Value must be an absolute path", path: ["value"] }
);

// ── Chat ──

export const sendChatMessageSchema = z.object({
  message: z.string().min(1, "Message must be between 1 and 10000 characters").max(10000, "Message must be between 1 and 10000 characters"),
});

// ── Env vars ──

export const putEnvVarsSchema = z.object({
  env_vars: z.array(z.object({ key: z.string(), value: z.string() }), {
    message: "env_vars must be an array of { key, value } objects",
  }),
});

export const postEnvVarSchema = z.object({
  key: z.string().min(1, "key is required"),
  value: z.string({ message: "value is required" }),
});

// ── Git ──

export const setRemoteSchema = z.object({
  repo_url: z.string().min(1, "repo_url is required"),
});

export const gitSettingsSchema = z.object({
  name: z.string().optional(),
  email: z.string().optional(),
}).refine((data) => data.name || data.email, {
  message: "At least one of name or email is required",
});

// ── Claude ──

export const claudeRespondSchema = z.object({
  response: z.string().min(1, "Response text is required"),
});

// ── Demo ──

export const demoGenerateSchema = z.object({
  script: z.string().min(1, "Missing required field: script"),
  voice: z.string().optional(),
});

export const demoScriptSchema = z.object({
  regenerateSeed: z.boolean().optional(),
});

// ── Models config ──

export const modelsConfigSchema = z.object({
  defaultModel: z.string().optional(),
  backgroundModel: z.string().optional(),
  defaultProvider: z.string().optional(),
  backgroundProvider: z.string().optional(),
});
