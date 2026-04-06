import type { ToolDefinition } from "../types";

export const seedDefinition: ToolDefinition = {
  id: "seed",
  name: "Seed Data",
  description: "Populate the database with test data",
  intentKeywords: "User wants to seed/populate the database with test/demo data. Examples: \"seed some data\", \"create test users\", \"populate the database\", \"add sample data\"",
  messageType: "seed",
};
