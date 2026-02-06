import type { APIRoute } from "astro";
import { createServerClient } from "../../../lib/supabase";
import { sendEmail, wrapEmailHtml, wrapEmailText } from "../../../lib/resend";

// Send onboarding email from Alpha asking for name + goal
export const POST: APIRoute = async ({ request }) => {
  try {
    const { email, userId } = await request.json();

    if (!email) {
      return new Response(JSON.stringify({ error: "Missing email" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const supabase = createServerClient();

    const html = wrapEmailHtml(`
      <p style="font-size: 16px; line-height: 1.6; margin-bottom: 16px;">
        yo! i'm alpha, your weekly accountability partner. 👋
      </p>
      
      <p style="font-size: 16px; line-height: 1.6; margin-bottom: 16px;">
        here's how this works: every sunday i'll check in on your goal. you reply, tell me how it went, and set a new one. no app, no dashboard — just email.
      </p>

      <p style="font-size: 16px; line-height: 1.6; margin-bottom: 16px;">
        to get started, just <strong>reply to this email</strong> with:
      </p>

      <ol style="font-size: 16px; line-height: 1.8; margin-bottom: 16px; padding-left: 20px;">
        <li><strong>your name</strong> (what you want me to call you)</li>
        <li><strong>a goal for this week</strong></li>
      </ol>

      <p style="font-size: 14px; line-height: 1.6; margin-bottom: 16px; color: #6b7280; background: #f9fafb; padding: 16px; border-radius: 12px;">
        <em>for example:</em><br><br>
        "hey! i'm jamie. my goal this week is to finish the first draft of my blog post and send it to 2 friends for feedback."<br><br>
        or even just:<br><br>
        "sarah. run 3 times this week."
      </p>

      <p style="font-size: 16px; line-height: 1.6; margin-bottom: 16px;">
        keep it simple. hit reply and let's go.
      </p>

      <p style="font-size: 16px; color: #6b7280;">
        - alpha
      </p>
    `);

    const text = wrapEmailText(`yo! i'm alpha, your weekly accountability partner. 👋

here's how this works: every sunday i'll check in on your goal. you reply, tell me how it went, and set a new one. no app, no dashboard — just email.

to get started, just reply to this email with:

1. your name (what you want me to call you)
2. a goal for this week

for example:

"hey! i'm jamie. my goal this week is to finish the first draft of my blog post and send it to 2 friends for feedback."

or even just:

"sarah. run 3 times this week."

keep it simple. hit reply and let's go.

- alpha`);

    await sendEmail({
      to: email,
      subject: "let's get you set up",
      html,
      text,
    });

    // Log the email
    if (userId) {
      await supabase.from("emails").insert({
        user_id: userId,
        direction: "outbound",
        subject: "let's get you set up",
        content: text,
      });
    }

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error: any) {
    console.error("Onboarding email error:", error);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
};
