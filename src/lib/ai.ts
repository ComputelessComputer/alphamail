import Anthropic from "@anthropic-ai/sdk";

const apiKey = import.meta.env.ANTHROPIC_API_KEY;

if (!apiKey) {
  console.warn("Missing ANTHROPIC_API_KEY - AI features will not work");
}

const anthropic = apiKey ? new Anthropic({ apiKey }) : null;

interface ParsedReply {
  progress: string;
  completed: boolean;
  nextGoal: string | null;
  mood: "positive" | "neutral" | "negative";
}

interface AlphaResponse {
  message: string;
  askForNextGoal: boolean;
}

export async function parseUserReply(
  userMessage: string,
  currentGoal: string
): Promise<ParsedReply> {
  if (!anthropic) {
    throw new Error("AI not configured");
  }

  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 500,
    messages: [
      {
        role: "user",
        content: `You are parsing a user's reply to a weekly goal check-in email.

Their goal was: "${currentGoal}"

Their reply:
"""
${userMessage}
"""

Extract the following as JSON:
{
  "progress": "brief summary of what they did or didn't do",
  "completed": true/false (did they complete or mostly complete the goal?),
  "nextGoal": "their next goal if mentioned, or null",
  "mood": "positive" | "neutral" | "negative" (based on their tone)
}

Only respond with valid JSON, nothing else.`,
      },
    ],
  });

  const content = response.content[0];
  if (content.type !== "text") {
    throw new Error("Unexpected response type");
  }

  return JSON.parse(content.text);
}

export async function generateAlphaResponse(
  firstName: string,
  currentGoal: string,
  parsed: ParsedReply
): Promise<AlphaResponse> {
  if (!anthropic) {
    throw new Error("AI not configured");
  }

  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 500,
    messages: [
      {
        role: "user",
        content: `You are Alpha, a casual and supportive AI accountability partner. Write a short, personal response to a user's weekly check-in.

User: ${firstName}
Their goal was: "${currentGoal}"
What they reported: "${parsed.progress}"
Did they complete it: ${parsed.completed}
Their mood seems: ${parsed.mood}
${parsed.nextGoal ? `They mentioned their next goal: "${parsed.nextGoal}"` : "They didn't mention a next goal yet."}

Write a response that:
1. Is casual and personal (lowercase, friendly)
2. Acknowledges their progress honestly (don't be fake positive)
3. Is brief (2-4 sentences max)
4. ${parsed.nextGoal ? "Acknowledges their next goal" : "Asks what their next goal is"}

Also indicate if you need to ask for their next goal.

Respond as JSON:
{
  "message": "your response here",
  "askForNextGoal": true/false
}

Only respond with valid JSON.`,
      },
    ],
  });

  const content = response.content[0];
  if (content.type !== "text") {
    throw new Error("Unexpected response type");
  }

  return JSON.parse(content.text);
}
