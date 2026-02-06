import Anthropic from "@anthropic-ai/sdk";

const apiKey = import.meta.env.ANTHROPIC_API_KEY;

if (!apiKey) {
  console.warn("Missing ANTHROPIC_API_KEY - AI features will not work");
}

const anthropic = apiKey ? new Anthropic({ apiKey }) : null;

// Retry configuration
const MAX_RETRIES = 3;
const INITIAL_DELAY_MS = 1000;

// Retry wrapper with exponential backoff
async function withRetry<T>(
  fn: () => Promise<T>,
  retries = MAX_RETRIES
): Promise<T> {
  let lastError: Error | null = null;
  
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      return await fn();
    } catch (error: any) {
      lastError = error;
      console.error(`AI call failed (attempt ${attempt + 1}/${retries}):`, error.message);
      
      // Don't retry on certain errors
      if (error.status === 401 || error.status === 403) {
        throw error; // Auth errors won't be fixed by retrying
      }
      
      if (attempt < retries - 1) {
        const delay = INITIAL_DELAY_MS * Math.pow(2, attempt);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
  
  throw lastError;
}

export interface EmailMessage {
  direction: "inbound" | "outbound";
  content: string;
  created_at: string;
}

export interface ParsedReply {
  progress: string;
  completed: boolean;
  nextGoal: string | null;
  mood: "positive" | "neutral" | "negative";
}

interface AlphaResponse {
  message: string;
  askForNextGoal: boolean;
}

// Flag to indicate AI failure (used by callers to send fallback email)
export class AIFailureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AIFailureError";
  }
}

export async function parseUserReply(
  userMessage: string,
  currentGoal: string
): Promise<ParsedReply> {
  if (!anthropic) {
    throw new AIFailureError("AI not configured");
  }

  return withRetry(async () => {
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

IMPORTANT for nextGoal extraction:
- Look for phrases like "next week", "my next goal", "this week I want to", "planning to", "going to", "I'll", "I will", "I'm gonna"
- Also look for future tense statements about what they want to accomplish
- If they mention something they want to do but aren't explicit about it being a goal, still extract it as nextGoal
- Clean up the goal text to be concise and actionable

Only respond with valid JSON, nothing else.`,
        },
      ],
    });

    const content = response.content[0];
    if (content.type !== "text") {
      throw new Error("Unexpected response type");
    }

    return JSON.parse(content.text);
  });
}

export async function generateAlphaResponse(
  firstName: string,
  currentGoal: string,
  parsed: ParsedReply,
  conversationHistory: EmailMessage[] = []
): Promise<AlphaResponse> {
  if (!anthropic) {
    throw new AIFailureError("AI not configured");
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

  return withRetry(async () => {
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
  });
}

// Generic conversation function for open-ended back-and-forth
export async function generateConversation(
  firstName: string,
  userMessage: string,
  conversationHistory: EmailMessage[] = [],
  currentGoal: string | null = null
): Promise<string> {
  if (!anthropic) {
    throw new AIFailureError("AI not configured");
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

  return withRetry(async () => {
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
  });
}

// Parse onboarding reply to extract name and first goal
export interface OnboardingInfo {
  name: string;
  goal: string;
  parsed: boolean; // false if we couldn't extract the info
  clarificationMessage?: string; // message to send if we need more info
}

export async function parseOnboardingReply(
  userMessage: string
): Promise<OnboardingInfo> {
  if (!anthropic) {
    throw new AIFailureError("AI not configured");
  }

  return withRetry(async () => {
    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 500,
      messages: [
        {
          role: "user",
          content: `You are parsing a new user's reply to an onboarding email. They were asked to share their name and a goal for the week.

Their reply:
"""
${userMessage}
"""

Extract the following as JSON:
{
  "name": "their first name (just the first name, not full name)",
  "goal": "their goal for the week, cleaned up to be concise and actionable",
  "parsed": true/false (true if you could extract BOTH name and goal),
  "clarificationMessage": "a casual message asking for what's missing (only if parsed is false)"
}

Rules:
- Be generous in parsing - people write in all sorts of ways
- If they say "I'm John and I want to run 3 times" → name: "John", goal: "run 3 times this week"
- If they just say "Sarah" with no goal, set parsed: false and ask for a goal
- If they just describe a goal with no name, set parsed: false and ask for their name
- If the message is unclear or off-topic, set parsed: false
- For clarificationMessage, write as Alpha (casual, lowercase, friendly)

Only respond with valid JSON.`,
        },
      ],
    });

    const content = response.content[0];
    if (content.type !== "text") {
      throw new Error("Unexpected response type");
    }

    return JSON.parse(content.text);
  });
}

// Conversational onboarding - naturally extract name + goal across multiple messages
export interface OnboardingConversationResult {
  complete: boolean;
  name?: string;
  goal?: string;
  reply: string; // Alpha's natural reply (used when complete is false)
}

export async function onboardingConversation(
  latestMessage: string,
  conversationHistory: EmailMessage[] = []
): Promise<OnboardingConversationResult> {
  if (!anthropic) {
    throw new AIFailureError("AI not configured");
  }

  let conversationContext = "";
  if (conversationHistory.length > 0) {
    conversationContext = `\nConversation so far (oldest first):\n---\n`;
    for (const msg of conversationHistory) {
      const speaker = msg.direction === "inbound" ? "User" : "Alpha";
      conversationContext += `${speaker}: ${msg.content}\n---\n`;
    }
  }

  return withRetry(async () => {
    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 500,
      messages: [
        {
          role: "user",
          content: `You are Alpha, a casual AI accountability partner. A new user is emailing you for the first time. You need to learn their name and a goal for the week, but you should do this through natural conversation, not by rigidly asking for fields.

${conversationContext}
User's latest message:
"""${latestMessage}"""

Look at the ENTIRE conversation (all messages, not just the latest) to figure out if you have both their name and a goal.

Respond as JSON:
{
  "complete": true/false (true ONLY if you have BOTH a name and a goal from anywhere in the conversation),
  "name": "their first name if found anywhere in the conversation",
  "goal": "their goal, cleaned up to be concise and actionable",
  "reply": "your natural response as Alpha"
}

Rules:
- Be generous in parsing. Names and goals can come from ANY message in the conversation, not just the latest one.
- If you already know their name from a previous message, you don't need to ask again.
- If you already know their goal from a previous message, you don't need to ask again.
- When complete is true, make your reply a welcome/confirmation message.
- When complete is false, have a natural conversation. Don't say "i need your name and goal". Instead, be friendly and steer the conversation. For example if they just said "hey", you might say "hey! i'm alpha. what's your name?" or if they gave their name, acknowledge it and ask what they're working on this week.
- Keep replies casual, lowercase, brief (2-3 sentences).
- Don't use emojis or em-dashes.

Only respond with valid JSON.`,
        },
      ],
    });

    const content = response.content[0];
    if (content.type !== "text") {
      throw new Error("Unexpected response type");
    }

    return JSON.parse(content.text);
  });
}

// Generate a summary of user's journey for their account page
export async function generateUserSummary(
  firstName: string,
  conversationHistory: EmailMessage[],
  goalsCompleted: number,
  currentGoal: string | null,
  weeksActive: number
): Promise<string> {
  if (!anthropic) {
    throw new AIFailureError("AI not configured");
  }

  // Build conversation context (last 20 messages)
  let conversationContext = "";
  const recentMessages = conversationHistory.slice(-20);
  if (recentMessages.length > 0) {
    conversationContext = `Recent conversations:\n---\n`;
    for (const msg of recentMessages) {
      const speaker = msg.direction === "inbound" ? firstName : "Alpha";
      conversationContext += `${speaker}: ${msg.content}\n---\n`;
    }
  }

  return withRetry(async () => {
    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 300,
      messages: [
        {
          role: "user",
          content: `Write a brief, personal summary of this user's journey with Alpha (the AI accountability partner). This will be shown on their account page.

User: ${firstName}
Weeks active: ${weeksActive}
Goals completed: ${goalsCompleted}
Current goal: ${currentGoal || "None right now"}

${conversationContext}

Write 2-3 sentences that:
1. Feel personal and specific to them (reference actual things they've shared)
2. Are encouraging but honest
3. Use casual lowercase style like Alpha's emails
4. Focus on their progress and journey, not stats

Just write the summary text, nothing else.`,
        },
      ],
    });

    const content = response.content[0];
    if (content.type !== "text") {
      throw new Error("Unexpected response type");
    }

    return content.text.trim();
  });
}
