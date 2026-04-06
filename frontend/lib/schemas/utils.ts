import type { ZodError } from "zod";

export function formatZodError(error: ZodError): string {
  return error.issues.map((e) => e.message).join("; ");
}
