import type { APIRoute } from "astro";
import { createServerClient } from "../../../lib/supabase";
import { sendEmail, wrapEmailHtml, wrapEmailText } from "../../../lib/resend";

export const POST: APIRoute = async ({ request }) => {
  try {
    const { token } = await request.json();

    if (!token) {
      return new Response(JSON.stringify({ error: "Missing token" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const supabase = createServerClient();

    // Validate the token server-side
    const { data: { user }, error } = await supabase.auth.getUser(token);
    if (error || !user) {
      console.error("Token validation failed:", error?.message);
      return new Response(JSON.stringify({ error: "Invalid token" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    await sendOnboardingEmail(supabase, user.email!, user.id);

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

async function sendOnboardingEmail(
  supabase: ReturnType<typeof createServerClient>,
  email: string,
  userId?: string
) {
  const html = wrapEmailHtml(`
      <p style="font-size: 16px; line-height: 1.6; margin-bottom: 16px;">
        hey, thanks for confirming -- good to know you're a real human.
      </p>

      <p style="font-size: 16px; line-height: 1.6; margin-bottom: 16px;">
        i'm alpha, your weekly accountability partner. every sunday i'll check in on your goal. you reply, tell me how it went, and set a new one. no app, no dashboard -- just email.
      </p>

      <p style="font-size: 16px; line-height: 1.6; margin-bottom: 16px;">
        i want to get started right away. just <strong>reply to this email</strong> with:
      </p>

      <ol style="font-size: 16px; line-height: 1.8; margin-bottom: 16px; padding-left: 20px;">
        <li><strong>your name</strong> (what you want me to call you)</li>
        <li><strong>a goal for this week</strong> -- or honestly, anything on your mind</li>
      </ol>

      <p style="font-size: 14px; line-height: 1.6; margin-bottom: 16px; color: #6b7280; background: #f9fafb; padding: 16px; border-radius: 12px;">
        <em>for example:</em><br><br>
        "hey, i'm jamie. my goal this week is to finish the first draft of my blog post and send it to 2 friends for feedback."<br><br>
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

    const text = wrapEmailText(`hey, thanks for confirming -- good to know you're a real human.

i'm alpha, your weekly accountability partner. every sunday i'll check in on your goal. you reply, tell me how it went, and set a new one. no app, no dashboard -- just email.

i want to get started right away. just reply to this email with:

1. your name (what you want me to call you)
2. a goal for this week -- or honestly, anything on your mind

for example:

"hey, i'm jamie. my goal this week is to finish the first draft of my blog post and send it to 2 friends for feedback."

or even just:

"sarah. run 3 times this week."

keep it simple. hit reply and let's go.

- alpha`);

    const emailSubject = "hey, let's get started";

    await sendEmail({
      to: email,
      subject: emailSubject,
      html,
      text,
    });

    if (userId) {
      await supabase.from("emails").insert({
        user_id: userId,
        direction: "outbound",
        subject: emailSubject,
        content: text,
      });
    }
}
