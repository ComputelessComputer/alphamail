import type { APIRoute } from "astro";
import { createServerClient } from "../../../lib/supabase";
import { sendEmail, wrapEmailHtml, wrapEmailText } from "../../../lib/resend";
import { parseUserReply, generateAlphaResponse, generateConversation, generateUserSummary, type EmailMessage } from "../../../lib/ai";

const APP_URL = import.meta.env.PUBLIC_APP_URL || "https://bealphamail.com";

// Helper to extract email addresses from CC header
function parseCCEmails(ccHeader: string | undefined): string[] {
  if (!ccHeader) return [];
  // CC header can be "Name <email@example.com>, other@example.com"
  const emailRegex = /[\w.-]+@[\w.-]+\.[a-zA-Z]{2,}/g;
  return ccHeader.match(emailRegex) || [];
}

// Resend inbound email webhook
// Configure this URL in Resend dashboard: https://resend.com/webhooks
export const POST: APIRoute = async ({ request }) => {
  try {
    const payload = await request.json();

    // Resend webhook payload structure
    const { type, data } = payload;

    // Only process email.received events
    if (type !== "email.received") {
      return new Response(JSON.stringify({ message: "Ignored event type" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    const { from, subject, text, html, headers, cc } = data;

    // Extract sender email
    const senderEmail = from?.email || from;
    if (!senderEmail) {
      return new Response(JSON.stringify({ error: "No sender email" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const supabase = createServerClient();
    const userMessage = text || html || "";

    // Parse CC'd emails
    const ccEmails = parseCCEmails(cc || headers?.cc || headers?.Cc);

    // Find user by email
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("user_id, first_name, email")
      .eq("email", senderEmail)
      .single();

    // Handle non-authenticated users
    if (profileError || !profile) {
      console.log("New sender (not signed up):", senderEmail);
      return await handleNonAuthenticatedUser(supabase, senderEmail, subject, userMessage, ccEmails);
    }

    const firstName = profile.first_name || "there";

    // Check for CC'd users and handle accordingly
    let ccNote = "";
    if (ccEmails.length > 0) {
      ccNote = await handleCCUsers(supabase, profile.user_id, firstName, ccEmails);
    }

    // Try to find existing thread from In-Reply-To header or subject
    let threadId: string | null = null;
    const inReplyTo = headers?.['in-reply-to'] || headers?.['In-Reply-To'];
    const references = headers?.['references'] || headers?.['References'];

    // First, try to find thread by subject (remove re: prefix and match)
    const cleanSubject = (subject || "").replace(/^re:\s*/i, "").trim();
    if (cleanSubject) {
      const { data: existingThread } = await supabase
        .from("emails")
        .select("thread_id")
        .eq("user_id", profile.user_id)
        .ilike("subject", `%${cleanSubject}%`)
        .not("thread_id", "is", null)
        .order("created_at", { ascending: false })
        .limit(1)
        .single();
      
      if (existingThread?.thread_id) {
        threadId = existingThread.thread_id;
      }
    }

    // Get conversation history for this thread (or recent emails if no thread)
    let conversationHistory: EmailMessage[] = [];
    if (threadId) {
      const { data: threadEmails } = await supabase
        .from("emails")
        .select("direction, content, created_at")
        .eq("thread_id", threadId)
        .order("created_at", { ascending: true })
        .limit(20);
      
      if (threadEmails) {
        conversationHistory = threadEmails as EmailMessage[];
      }
    } else {
      // No thread found - get recent emails for context
      const { data: recentEmails } = await supabase
        .from("emails")
        .select("direction, content, created_at")
        .eq("user_id", profile.user_id)
        .order("created_at", { ascending: false })
        .limit(10);
      
      if (recentEmails) {
        conversationHistory = recentEmails.reverse() as EmailMessage[];
      }
    }

    // Store the inbound email
    const { data: inboundEmail } = await supabase.from("emails").insert({
      user_id: profile.user_id,
      direction: "inbound",
      subject: subject || "No subject",
      content: userMessage,
      thread_id: threadId, // Will be null if new conversation
    }).select("id").single();

    // If this is a new thread, set thread_id to this email's id
    if (!threadId && inboundEmail) {
      threadId = inboundEmail.id;
      await supabase
        .from("emails")
        .update({ thread_id: inboundEmail.id })
        .eq("id", inboundEmail.id);
    }

    // Get user's current active goal
    const { data: currentGoal } = await supabase
      .from("goals")
      .select("*")
      .eq("user_id", profile.user_id)
      .eq("completed", false)
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    // Build email subject for reply (keep threading)
    const replySubject = (subject || "").toLowerCase().startsWith("re:") 
      ? subject 
      : "re: " + (subject || "check-in");

    if (!currentGoal) {
      // No active goal - use general conversation AI
      const alphaResponse = await generateConversation(
        firstName,
        userMessage,
        conversationHistory,
        null
      );

      // Check if user is setting a new goal in their message
      const goalMatch = userMessage.toLowerCase().match(/(?:goal|want to|going to|plan to|trying to|will)\s+(.+)/i);
      let responseText = alphaResponse;

      if (goalMatch) {
        // They might be setting a goal - create it
        const nextSunday = new Date();
        nextSunday.setDate(nextSunday.getDate() + (7 - nextSunday.getDay()));

        await supabase.from("goals").insert({
          user_id: profile.user_id,
          description: goalMatch[1].trim().substring(0, 200),
          due_date: nextSunday.toISOString().split("T")[0],
        });

        responseText += "\n\ngot it, i'll check in with you sunday on that.";
      }

      // Add CC note if applicable
      if (ccNote) {
        responseText += "\n\n" + ccNote;
      }

      const responseHtml = wrapEmailHtml(`
        <p style="font-size: 16px; line-height: 1.6; margin-bottom: 16px;">yo ${firstName}</p>
        <p style="font-size: 16px; line-height: 1.6; margin-bottom: 16px; white-space: pre-wrap;">${responseText}</p>
        <p style="font-size: 16px; color: #6b7280;">- alpha</p>
      `);

      await sendEmail({
        to: profile.email,
        subject: replySubject,
        html: responseHtml,
        text: wrapEmailText(`yo ${firstName}\n\n${responseText}\n\n- alpha`),
      });

      // Store outbound email in thread
      await supabase.from("emails").insert({
        user_id: profile.user_id,
        direction: "outbound",
        subject: replySubject,
        content: responseText,
        thread_id: threadId,
      });

      // Update user summary in background (don't await)
      updateUserSummary(supabase, profile.user_id, firstName).catch(console.error);

      return new Response(JSON.stringify({ success: true, action: "conversation" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Parse the user's reply with AI
    const parsed = await parseUserReply(userMessage, currentGoal.description);

    // Update the goal if completed
    if (parsed.completed) {
      await supabase
        .from("goals")
        .update({ completed: true, completed_at: new Date().toISOString() })
        .eq("id", currentGoal.id);
    }

    // Create next goal if mentioned
    if (parsed.nextGoal) {
      const nextSunday = new Date();
      nextSunday.setDate(nextSunday.getDate() + (7 - nextSunday.getDay()));

      await supabase.from("goals").insert({
        user_id: profile.user_id,
        description: parsed.nextGoal,
        due_date: nextSunday.toISOString().split("T")[0],
      });
    }

    // Update inbound email with parsed info
    if (inboundEmail) {
      await supabase
        .from("emails")
        .update({ summary: parsed.progress, mood: parsed.mood })
        .eq("id", inboundEmail.id);
    }

    // Generate Alpha's response with conversation history
    const alphaResponse = await generateAlphaResponse(
      firstName,
      currentGoal.description,
      parsed,
      conversationHistory
    );

    // Build response email
    let responseText = alphaResponse.message;
    if (alphaResponse.askForNextGoal) {
      responseText += "\n\nso what's your goal for this week?";
    } else if (parsed.nextGoal) {
      responseText += `\n\ngot it. your new goal: ${parsed.nextGoal}. i'll check in sunday.`;
    }

    // Add CC note if applicable
    if (ccNote) {
      responseText += "\n\n" + ccNote;
    }

    const responseHtml = wrapEmailHtml(`
      <p style="font-size: 16px; line-height: 1.6; margin-bottom: 16px;">yo ${firstName}</p>
      <p style="font-size: 16px; line-height: 1.6; margin-bottom: 16px; white-space: pre-wrap;">${responseText}</p>
      <p style="font-size: 16px; color: #6b7280;">- alpha</p>
    `);

    await sendEmail({
      to: profile.email,
      subject: replySubject,
      html: responseHtml,
      text: wrapEmailText(`yo ${firstName}\n\n${responseText}\n\n- alpha`),
    });

    // Store outbound email in thread
    await supabase.from("emails").insert({
      user_id: profile.user_id,
      direction: "outbound",
      subject: replySubject,
      content: responseText,
      thread_id: threadId,
    });

    // Update user summary in background (don't await)
    updateUserSummary(supabase, profile.user_id, firstName).catch(console.error);

    console.log(`Processed email from ${senderEmail}, completed: ${parsed.completed}`);

    return new Response(JSON.stringify({ success: true, parsed, threadId }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error: any) {
    console.error("Inbound email error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
};

// Update user summary after conversations
async function updateUserSummary(
  supabase: ReturnType<typeof createServerClient>,
  userId: string,
  firstName: string
) {
  try {
    // Get conversation history
    const { data: emails } = await supabase
      .from("emails")
      .select("direction, content, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: true })
      .limit(50);

    // Get goals
    const { data: goals } = await supabase
      .from("goals")
      .select("*")
      .eq("user_id", userId);

    // Get profile for created_at
    const { data: profile } = await supabase
      .from("profiles")
      .select("created_at")
      .eq("user_id", userId)
      .single();

    if (!profile) return;

    const completedGoals = goals?.filter(g => g.completed).length || 0;
    const currentGoal = goals?.find(g => !g.completed);
    const createdAt = new Date(profile.created_at);
    const now = new Date();
    const weeksActive = Math.max(1, Math.ceil((now.getTime() - createdAt.getTime()) / (7 * 24 * 60 * 60 * 1000)));

    const summary = await generateUserSummary(
      firstName,
      (emails || []) as EmailMessage[],
      completedGoals,
      currentGoal?.description || null,
      weeksActive
    );

    await supabase
      .from("profiles")
      .update({ summary })
      .eq("user_id", userId);

    console.log(`Updated summary for user ${userId}`);
  } catch (error) {
    console.error("Failed to update user summary:", error);
  }
}

// Handle emails from non-authenticated users
async function handleNonAuthenticatedUser(
  supabase: ReturnType<typeof createServerClient>,
  senderEmail: string,
  subject: string | undefined,
  userMessage: string,
  ccEmails: string[]
) {
  // Check if we've already received emails from this person
  const { data: existingPending } = await supabase
    .from("pending_emails")
    .select("id, thread_id")
    .eq("email", senderEmail)
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  // Store this email
  const { data: pendingEmail } = await supabase.from("pending_emails").insert({
    email: senderEmail,
    subject: subject || "No subject",
    content: userMessage,
    thread_id: existingPending?.thread_id || null,
  }).select("id").single();

  // If first email, set thread_id to itself
  if (!existingPending?.thread_id && pendingEmail) {
    await supabase
      .from("pending_emails")
      .update({ thread_id: pendingEmail.id })
      .eq("id", pendingEmail.id);
  }

  // Build reply subject (keep thread)
  const replySubject = (subject || "").toLowerCase().startsWith("re:") 
    ? subject 
    : "re: " + (subject || "hello");

  // Send intro email
  const isFirstEmail = !existingPending;
  let responseText: string;

  if (isFirstEmail) {
    responseText = `yo! i'm alpha, your ai accountability partner.

i help people actually follow through on their goals by checking in every sunday. no app, no complicated system - just email.

want to try it? sign up here and we can keep chatting:
${APP_URL}/signup?email=${encodeURIComponent(senderEmail)}

once you're in, just tell me what you want to accomplish this week and i'll hold you to it.`;
  } else {
    responseText = `hey again! looks like you haven't signed up yet.

i'd love to keep chatting, but i need you to create an account first so i can remember our conversations and actually help you with your goals.

it takes 30 seconds:
${APP_URL}/signup?email=${encodeURIComponent(senderEmail)}

see you on the other side.`;
  }

  const responseHtml = wrapEmailHtml(`
    <p style="font-size: 16px; line-height: 1.6; margin-bottom: 16px;">yo!</p>
    <p style="font-size: 16px; line-height: 1.6; margin-bottom: 16px; white-space: pre-wrap;">${responseText.replace(`${APP_URL}/signup?email=${encodeURIComponent(senderEmail)}`, `<a href="${APP_URL}/signup?email=${encodeURIComponent(senderEmail)}" style="color: #2563eb;">${APP_URL}/signup</a>`)}</p>
    <p style="font-size: 16px; color: #6b7280;">- alpha</p>
  `);

  await sendEmail({
    to: senderEmail,
    subject: replySubject,
    html: responseHtml,
    text: wrapEmailText(`yo!\n\n${responseText}\n\n- alpha`),
  });

  console.log(`Sent intro email to non-authenticated user: ${senderEmail}`);

  return new Response(JSON.stringify({ 
    success: true, 
    action: "intro_sent",
    isFirstEmail,
  }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

// Handle CC'd users
async function handleCCUsers(
  supabase: ReturnType<typeof createServerClient>,
  senderUserId: string,
  senderFirstName: string,
  ccEmails: string[]
): Promise<string> {
  if (ccEmails.length === 0) return "";

  // Check which CC'd emails are existing users
  const { data: ccProfiles } = await supabase
    .from("profiles")
    .select("user_id, email, first_name")
    .in("email", ccEmails);

  const existingUsers = ccProfiles || [];
  const nonUsers = ccEmails.filter(
    email => !existingUsers.some(u => u.email === email)
  );

  let ccNote = "";

  // Handle non-users that were CC'd
  if (nonUsers.length > 0) {
    const nonUserNames = nonUsers.map(e => e.split("@")[0]).join(", ");
    ccNote = `btw, i noticed you cc'd ${nonUserNames}. if you want them to join our accountability sessions, tell them to sign up at ${APP_URL} and then we can do group goals together.`;
  }

  // Handle existing users that were CC'd
  if (existingUsers.length > 0) {
    const userNames = existingUsers.map(u => u.first_name || u.email.split("@")[0]).join(", ");
    
    // Check if they're already in a group together
    const { data: existingGroup } = await supabase
      .from("group_members")
      .select("group_id")
      .eq("user_id", senderUserId)
      .limit(1)
      .single();

    if (existingGroup) {
      // Check if CC'd users are in the same group
      const { data: groupMembers } = await supabase
        .from("group_members")
        .select("user_id")
        .eq("group_id", existingGroup.group_id);

      const groupUserIds = (groupMembers || []).map(m => m.user_id);
      const ccUserIds = existingUsers.map(u => u.user_id);
      const allInGroup = ccUserIds.every(id => groupUserIds.includes(id));

      if (!allInGroup) {
        ccNote = `i see you cc'd ${userNames} - they're already using alphamail! want to start a group accountability session together? just reply "yes" and i'll set it up.`;
      }
    } else {
      ccNote = `i see you cc'd ${userNames} - they're already using alphamail! want to start a group accountability session together? just reply "yes, add ${userNames}" and i'll set it up.`;
    }
  }

  return ccNote;
}
