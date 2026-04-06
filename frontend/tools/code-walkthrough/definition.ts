import type { ToolDefinition } from "../types";

export const codeWalkthroughDefinition: ToolDefinition = {
  id: "code-walkthrough",
  name: "Code Walkthrough",
  description: "Narrated explanation of code changes",
  intentKeywords: "User wants a narrated explanation of CODE CHANGES, diff, or implementation details — NOT a visual tour of the app UI. Examples: \"explain the code\", \"walk me through the diff\", \"what changed\", \"explain this implementation\", \"review the changes\"",
  messageType: "code-walkthrough",
};
