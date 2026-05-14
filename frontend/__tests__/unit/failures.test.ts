import { describe, it, expect } from "vitest";
import { categorizeFailure, failureMessage, type FailureCategory } from "@/lib/server/knowledge/failures";

describe("categorizeFailure", () => {
  it("categorizes AbortError by name", () => {
    const err = new Error("Operation was aborted");
    err.name = "AbortError";
    expect(categorizeFailure(err)).toBe("abort");
  });

  it("categorizes abort by message string", () => {
    expect(categorizeFailure("The request was aborted")).toBe("abort");
  });

  it("categorizes TimeoutError by name", () => {
    const err = new Error("timed out");
    err.name = "TimeoutError";
    expect(categorizeFailure(err)).toBe("timeout");
  });

  it("categorizes timeout by message", () => {
    expect(categorizeFailure("ETIMEDOUT connecting to provider")).toBe("timeout");
  });

  it("categorizes ECONNREFUSED as provider_unavailable", () => {
    expect(categorizeFailure("connect ECONNREFUSED 127.0.0.1:8080")).toBe("provider_unavailable");
  });

  it("categorizes ECONNRESET as provider_unavailable", () => {
    expect(categorizeFailure("read ECONNRESET")).toBe("provider_unavailable");
  });

  it("categorizes fetch failed as provider_unavailable", () => {
    expect(categorizeFailure("fetch failed")).toBe("provider_unavailable");
  });

  it("categorizes 500 as provider_error", () => {
    expect(categorizeFailure("HTTP 500 Internal Server Error")).toBe("provider_error");
  });

  it("categorizes 529 as provider_error", () => {
    expect(categorizeFailure("HTTP 529 overloaded")).toBe("provider_error");
  });

  it("categorizes rate limit as provider_error", () => {
    expect(categorizeFailure("rate limit exceeded")).toBe("provider_error");
  });

  it("categorizes ENOENT as dependency_missing", () => {
    expect(categorizeFailure("ENOENT: no such file or directory")).toBe("dependency_missing");
  });

  it("categorizes spawn errors as dependency_missing", () => {
    expect(categorizeFailure("spawn claude ENOENT")).toBe("dependency_missing");
  });

  it("categorizes command not found as dependency_missing", () => {
    expect(categorizeFailure("command not found: gh")).toBe("dependency_missing");
  });

  it("categorizes budget messages as budget_exceeded", () => {
    expect(categorizeFailure("Exceeded budget limit")).toBe("budget_exceeded");
  });

  it("categorizes max_turns as budget_exceeded", () => {
    expect(categorizeFailure("Exceeded max_turns (50/50)")).toBe("budget_exceeded");
  });

  it("categorizes context errors", () => {
    expect(categorizeFailure("Failed to assemble context")).toBe("context_error");
  });

  it("categorizes Bubblewrap sandbox errors as execution environment failures", () => {
    expect(categorizeFailure("bwrap: loopback: Failed RTM_NEWADDR: Operation not permitted")).toBe("execution_environment");
  });

  it("categorizes knowledge errors", () => {
    expect(categorizeFailure("knowledge index failed")).toBe("context_error");
  });

  it("returns unknown for unrecognised errors", () => {
    expect(categorizeFailure("something completely different")).toBe("unknown");
  });

  it("handles Error objects with empty message", () => {
    expect(categorizeFailure(new Error(""))).toBe("unknown");
  });
});

describe("failureMessage", () => {
  const categories: FailureCategory[] = [
    "timeout",
    "budget_exceeded",
    "provider_error",
    "provider_unavailable",
    "abort",
    "context_error",
    "execution_environment",
    "dependency_missing",
    "unknown",
  ];

  for (const category of categories) {
    it(`returns non-empty message for "${category}"`, () => {
      const msg = failureMessage(category);
      expect(msg).toBeTruthy();
      expect(typeof msg).toBe("string");
      expect(msg.length).toBeGreaterThan(5);
    });
  }
});
