import type { APIRoute } from "astro";
import { createServerClient } from "../../../lib/supabase";
import { sendEmail } from "../../../lib/resend";
import { parseUserReply, generateAlphaResponse } from "../../../lib/ai";

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

    const { from, subject, text, html } = data;

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

    // Store the inbound email
    await supabase.from("emails").insert({
      user_id: profile.user_id,
      direction: "inbound",
      subject: subject || "No subject",
      content: userMessage,
    });

    // Get user's current active goal
    const { data: currentGoal } = await supabase
      .from("goals")
      .select("*")
      .eq("user_id", profile.user_id)
      .eq("completed", false)
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    if (!currentGoal) {
      // No active goal - ask them to set one
      const responseHtml = `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 40px 20px; color: #1a1a1a;">
          <p style="font-size: 16px; line-height: 1.6; margin-bottom: 16px;">yo ${firstName}</p>
          <p style="font-size: 16px; line-height: 1.6; margin-bottom: 16px;">looks like you don't have an active goal right now. what do you want to focus on this week?</p>
          <p style="font-size: 16px; line-height: 1.6; margin-bottom: 16px;">just reply with your goal and i'll check in with you sunday.</p>
          <p style="font-size: 16px; color: #6b7280;">- alpha</p>
        </div>
      `;

      await sendEmail({
        to: profile.email,
        subject: "re: " + (subject || "check-in"),
        html: responseHtml,
      });

      return new Response(JSON.stringify({ success: true, action: "asked_for_goal" }), {
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

    // Update email with parsed info
    await supabase
      .from("emails")
      .update({ summary: parsed.progress, mood: parsed.mood })
      .eq("user_id", profile.user_id)
      .eq("direction", "inbound")
      .order("created_at", { ascending: false })
      .limit(1);

    // Generate Alpha's response
    const alphaResponse = await generateAlphaResponse(
      firstName,
      currentGoal.description,
      parsed
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
      subject: "re: " + (subject || "check-in"),
      html: responseHtml,
      text: `yo ${firstName}\n\n${responseText}\n\n- alpha`,
    });

    // Log outbound email
    await supabase.from("emails").insert({
      user_id: profile.user_id,
      direction: "outbound",
      subject: "re: " + (subject || "check-in"),
      content: responseText,
    });

    console.log(`Processed email from ${senderEmail}, completed: ${parsed.completed}`);

    return new Response(JSON.stringify({ success: true, parsed }), {
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
