import type { ToolDefinition } from "../types";

export const walkthroughDefinition: ToolDefinition = {
  id: "walkthrough",
  name: "Walkthrough",
  description: "Interactive guided tour of the app",
  intentKeywords: "User wants a LIVE INTERACTIVE guided tour of the running app's UI — navigating pages, clicking buttons, showing features visually in the browser. Must be about touring the app itself, NOT about explaining code, changes, architecture, or implementation details. Examples: \"walk me through the app\", \"show me the main features\", \"give me a tour of the UI\", \"demo the app for me\"",
  messageType: "walkthrough",
};
