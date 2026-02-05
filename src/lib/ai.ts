import Anthropic from "@anthropic-ai/sdk";

const apiKey = import.meta.env.ANTHROPIC_API_KEY;

if (!apiKey) {
  console.warn("Missing ANTHROPIC_API_KEY - AI features will not work");
}

const anthropic = apiKey ? new Anthropic({ apiKey }) : null;

export interface EmailMessage {
  direction: "inbound" | "outbound";
  content: string;
  created_at: string;
}

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
  parsed: ParsedReply,
  conversationHistory: EmailMessage[] = []
): Promise<AlphaResponse> {
  if (!anthropic) {
    throw new Error("AI not configured");
  }

  // Build conversation context
  let conversationContext = "";
  if (conversationHistory.length > 0) {
    conversationContext = `\n\nPrevious conversation with this user (oldest first):\n---\n`;
    for (const msg of conversationHistory) {
      const speaker = msg.direction === "inbound" ? firstName : "Alpha";
      conversationContext += `${speaker}: ${msg.content}\n---\n`;
    }
  }

  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 500,
    messages: [
      {
        role: "user",
        content: `You are Alpha, a casual and supportive AI accountability partner. Write a short, personal response to a user's message.

User: ${firstName}
Their current goal: "${currentGoal}"
What they just said: "${parsed.progress}"
Did they complete their goal: ${parsed.completed}
Their mood seems: ${parsed.mood}
${parsed.nextGoal ? `They mentioned their next goal: "${parsed.nextGoal}"` : "They didn't mention a next goal yet."}
${conversationContext}

Write a response that:
1. Is casual and personal (lowercase, friendly)
2. Acknowledges what they said honestly (don't be fake positive)
3. Is brief (2-4 sentences max)
4. References past conversations naturally if relevant (but don't be weird about it)
5. ${parsed.nextGoal ? "Acknowledges their next goal" : "If their goal is complete and they haven't mentioned a next goal, gently ask what's next"}

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

// Generic conversation function for open-ended back-and-forth
export async function generateConversation(
  firstName: string,
  userMessage: string,
  conversationHistory: EmailMessage[] = [],
  currentGoal: string | null = null
): Promise<string> {
  if (!anthropic) {
    throw new Error("AI not configured");
  }

  // Build conversation context
  let conversationContext = "";
  if (conversationHistory.length > 0) {
    conversationContext = `\n\nConversation history (oldest first):\n---\n`;
    for (const msg of conversationHistory) {
      const speaker = msg.direction === "inbound" ? firstName : "Alpha";
      conversationContext += `${speaker}: ${msg.content}\n---\n`;
    }
  }

  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 500,
    messages: [
      {
        role: "user",
        content: `You are Alpha, a casual AI friend and accountability partner. You're having an ongoing email conversation with ${firstName}.

${currentGoal ? `Their current goal: "${currentGoal}"` : "They don't have an active goal right now."}

Their latest message:
"${userMessage}"
${conversationContext}

Respond naturally as Alpha:
1. Keep it casual and lowercase
2. Be a real friend - supportive but honest
3. Keep it brief (2-4 sentences usually)
4. Remember past conversations and reference them naturally
5. If they seem to be sharing something important, be a good listener
6. If it seems like they're done with their goal or want a new one, gently bring it up

Just respond with your message text, no JSON.`,
      },
    ],
  });

  const content = response.content[0];
  if (content.type !== "text") {
    throw new Error("Unexpected response type");
  }

  return content.text.trim();
}
