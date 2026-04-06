import { runEphemeralQuery } from "./sdk-helpers";
import { buildPRDescriptionPrompt } from "./prompts/git";

interface GeneratePRDescriptionParams {
  task: { title: string; description?: string };
  codeDiff: string;
  reflectionMessages: { role: string; content: string }[];
}

export async function generatePRDescription({
  task,
  codeDiff,
  reflectionMessages,
}: GeneratePRDescriptionParams): Promise<string> {
  const reflectionContext = reflectionMessages
    .filter((m) => m.role === "assistant")
    .map((m) => m.content)
    .join("\n\n")
    .slice(-6000);

  const prompt = buildPRDescriptionPrompt({
    taskTitle: task.title,
    taskDescription: task.description,
    reflectionContext,
    codeDiff,
  });

  return runEphemeralQuery(prompt, {
    category: "quick",
  });
}
