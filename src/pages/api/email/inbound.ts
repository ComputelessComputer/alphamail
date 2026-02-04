import type { APIRoute } from "astro";
import { createServerClient } from "../../../lib/supabase";

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

    const { from, to, subject, text, html } = data;

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
      .select("user_id, first_name")
      .eq("email", senderEmail)
      .single();

    if (profileError || !profile) {
      console.log("Unknown sender:", senderEmail);
      return new Response(JSON.stringify({ message: "Unknown sender" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Store the inbound email
    const { error: insertError } = await supabase.from("emails").insert({
      user_id: profile.user_id,
      direction: "inbound",
      subject: subject || "No subject",
      content: text || html || "",
    });

    if (insertError) {
      console.error("Failed to store email:", insertError);
    }

    // TODO: Process the email with AI to:
    // 1. Detect if it's a goal update or new goal
    // 2. Extract progress information
    // 3. Generate and send a response

    console.log(`Received email from ${senderEmail}: ${subject}`);

    return new Response(JSON.stringify({ success: true }), {
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
