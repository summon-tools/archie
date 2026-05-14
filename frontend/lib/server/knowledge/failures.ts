/**
 * Failure categorization for runs.
 * Maps errors to structured categories for better UX and debugging.
 */

export type FailureCategory =
  | "timeout"
  | "budget_exceeded"
  | "provider_error"
  | "provider_unavailable"
  | "abort"
  | "context_error"
  | "execution_environment"
  | "dependency_missing"
  | "unknown";

/**
 * Categorize a failure from an error or error string.
 */
export function categorizeFailure(error: Error | string): FailureCategory {
  const msg = typeof error === "string" ? error : error.message || "";
  const name = typeof error === "string" ? "" : error.name || "";

  // Abort
  if (name === "AbortError" || msg.includes("aborted") || msg.includes("abort")) {
    return "abort";
  }

  // Timeout
  if (name === "TimeoutError" || msg.includes("timeout") || msg.includes("ETIMEDOUT")) {
    return "timeout";
  }

  // Provider unavailable (connection errors)
  if (
    msg.includes("ECONNREFUSED") ||
    msg.includes("ECONNRESET") ||
    msg.includes("ENOTFOUND") ||
    msg.includes("fetch failed") ||
    msg.includes("socket hang up")
  ) {
    return "provider_unavailable";
  }

  // Provider error (5xx, rate limit, API errors)
  if (
    msg.includes("500") ||
    msg.includes("502") ||
    msg.includes("503") ||
    msg.includes("529") ||
    msg.includes("rate limit") ||
    msg.includes("overloaded") ||
    msg.includes("server error")
  ) {
    return "provider_error";
  }

  // Tool execution environment issues (sandbox/container/kernel restrictions)
  if (
    msg.includes("bwrap") ||
    msg.includes("bubblewrap") ||
    msg.includes("Failed RTM_NEWADDR") ||
    msg.includes("loopback") ||
    msg.includes("Operation not permitted") ||
    msg.includes("sandbox")
  ) {
    return "execution_environment";
  }

  // Dependency missing (spawn errors, missing binaries)
  if (
    msg.includes("ENOENT") ||
    msg.includes("spawn") ||
    msg.includes("not found") ||
    msg.includes("command not found") ||
    msg.includes("No such file")
  ) {
    return "dependency_missing";
  }

  // Budget exceeded
  if (msg.includes("budget") || msg.includes("max_turns") || msg.includes("max_duration")) {
    return "budget_exceeded";
  }

  // Context/knowledge errors
  if (msg.includes("context") || msg.includes("knowledge") || msg.includes("artifact")) {
    return "context_error";
  }

  return "unknown";
}

/** Human-readable failure message for UI display. */
export function failureMessage(category: FailureCategory): string {
  switch (category) {
    case "timeout": return "The operation timed out. Try again or simplify the request.";
    case "budget_exceeded": return "The run exceeded its budget (turns, time, or cost).";
    case "provider_error": return "The AI provider returned an error. It may be temporarily overloaded.";
    case "provider_unavailable": return "Could not reach the AI provider. Check your connection and API key.";
    case "abort": return "The operation was cancelled.";
    case "context_error": return "Failed to assemble context for this operation.";
    case "execution_environment": return "The tool execution environment blocked the run. Check sandbox or container permissions.";
    case "dependency_missing": return "A required tool or file was not found. Check the app directory.";
    case "unknown": return "An unexpected error occurred.";
  }
}
