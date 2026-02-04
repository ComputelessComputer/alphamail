import type { APIRoute } from "astro";
import { createServerClient } from "../../../lib/supabase";
import { sendEmail } from "../../../lib/resend";

export const POST: APIRoute = async ({ request }) => {
  try {
    const { userId } = await request.json();

    if (!userId) {
      return new Response(JSON.stringify({ error: "Missing userId" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const supabase = createServerClient();

    // Get user profile and goal
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("*")
      .eq("user_id", userId)
      .single();

    if (profileError || !profile) {
      return new Response(JSON.stringify({ error: "Profile not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }

    const { data: goal } = await supabase
      .from("goals")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    // Send welcome email
    const html = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 40px 20px;">
        <h1 style="font-size: 28px; font-weight: normal; color: #1a1a1a; margin-bottom: 24px;">
          Welcome to AlphaMail, ${profile.first_name}!
        </h1>
        
        <p style="font-size: 16px; line-height: 1.6; color: #4a4a4a; margin-bottom: 16px;">
          I'm Alpha, your weekly accountability partner. I'm here to help you stay on track with your goals through simple email check-ins.
        </p>

        ${goal ? `
        <div style="background: #f8fafc; border-radius: 12px; padding: 20px; margin: 24px 0;">
          <p style="font-size: 14px; color: #6b7280; margin: 0 0 8px 0;">Your first goal:</p>
          <p style="font-size: 16px; color: #1a1a1a; margin: 0; font-weight: 500;">${goal.description}</p>
          <p style="font-size: 14px; color: #6b7280; margin: 8px 0 0 0;">Due: Sunday</p>
        </div>
        ` : ''}

        <p style="font-size: 16px; line-height: 1.6; color: #4a4a4a; margin-bottom: 16px;">
          Here's how it works:
        </p>

        <ul style="font-size: 16px; line-height: 1.8; color: #4a4a4a; padding-left: 20px; margin-bottom: 24px;">
          <li>Every Sunday, I'll send you a check-in email</li>
          <li>Reply with your progress — what went well, what didn't</li>
          <li>I'll give you honest feedback and ask about your next goal</li>
          <li>Repeat weekly!</li>
        </ul>

        <p style="font-size: 16px; line-height: 1.6; color: #4a4a4a; margin-bottom: 24px;">
          Good luck with your goal this week. I'll check in with you on Sunday!
        </p>

        <p style="font-size: 16px; color: #4a4a4a;">
          — Alpha
        </p>
      </div>
    `;

    const text = `
Welcome to AlphaMail, ${profile.first_name}!

I'm Alpha, your weekly accountability partner. I'm here to help you stay on track with your goals through simple email check-ins.

${goal ? `Your first goal: ${goal.description}\nDue: Sunday\n` : ''}

Here's how it works:
- Every Sunday, I'll send you a check-in email
- Reply with your progress — what went well, what didn't
- I'll give you honest feedback and ask about your next goal
- Repeat weekly!

Good luck with your goal this week. I'll check in with you on Sunday!

— Alpha
    `;

    await sendEmail({
      to: profile.email,
      subject: `Welcome to AlphaMail, ${profile.first_name}!`,
      html,
      text,
    });

    // Log the email
    await supabase.from("emails").insert({
      user_id: userId,
      direction: "outbound",
      subject: `Welcome to AlphaMail, ${profile.first_name}!`,
      content: text,
    });

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error: any) {
    console.error("Welcome email error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
};
