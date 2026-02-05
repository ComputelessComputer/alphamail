import type { APIRoute } from "astro";
import { createServerClient } from "../../../lib/supabase";
import { sendEmail } from "../../../lib/resend";
import { parseUserReply, generateAlphaResponse, generateConversation, type EmailMessage } from "../../../lib/ai";

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

    const { from, subject, text, html, headers } = data;

    // Extract sender email
    const senderEmail = from?.email || from;
    if (!senderEmail) {
      return new Response(JSON.stringify({ error: "No sender email" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const supabase = createServerClient();

    // Find user by email
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("user_id, first_name, email")
      .eq("email", senderEmail)
      .single();

    if (profileError || !profile) {
      console.log("Unknown sender:", senderEmail);
      return new Response(JSON.stringify({ message: "Unknown sender" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    const userMessage = text || html || "";
    const firstName = profile.first_name || "there";

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

      const responseHtml = `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 40px 20px; color: #1a1a1a;">
          <p style="font-size: 16px; line-height: 1.6; margin-bottom: 16px;">yo ${firstName}</p>
          <p style="font-size: 16px; line-height: 1.6; margin-bottom: 16px; white-space: pre-wrap;">${responseText}</p>
          <p style="font-size: 16px; color: #6b7280;">- alpha</p>
        </div>
      `;

      await sendEmail({
        to: profile.email,
        subject: replySubject,
        html: responseHtml,
        text: `yo ${firstName}\n\n${responseText}\n\n- alpha`,
      });

      // Store outbound email in thread
      await supabase.from("emails").insert({
        user_id: profile.user_id,
        direction: "outbound",
        subject: replySubject,
        content: responseText,
        thread_id: threadId,
      });

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

    const responseHtml = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 40px 20px; color: #1a1a1a;">
        <p style="font-size: 16px; line-height: 1.6; margin-bottom: 16px;">yo ${firstName}</p>
        <p style="font-size: 16px; line-height: 1.6; margin-bottom: 16px; white-space: pre-wrap;">${responseText}</p>
        <p style="font-size: 16px; color: #6b7280;">- alpha</p>
      </div>
    `;

    await sendEmail({
      to: profile.email,
      subject: replySubject,
      html: responseHtml,
      text: `yo ${firstName}\n\n${responseText}\n\n- alpha`,
    });

    // Store outbound email in thread
    await supabase.from("emails").insert({
      user_id: profile.user_id,
      direction: "outbound",
      subject: replySubject,
      content: responseText,
      thread_id: threadId,
    });

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
