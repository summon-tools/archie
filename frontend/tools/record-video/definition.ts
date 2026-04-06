import type { ToolDefinition } from "../types";

export const recordVideoDefinition: ToolDefinition = {
  id: "record-video",
  name: "Record Video",
  description: "Record a demo video of the app",
  intentKeywords: "User wants to record a demo video of the app. Examples: \"record a video\", \"make a demo video\", \"capture a screen recording\"",
  messageType: "video",
};
