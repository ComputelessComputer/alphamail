import type { APIRoute } from "astro";
import { createServerClient } from "../../../lib/supabase";
import { sendEmail, wrapEmailHtml, wrapEmailText, escapeHtml } from "../../../lib/resend";

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
    const safeFirstName = escapeHtml(profile.first_name || "there");
    const safeGoalDesc = goal ? escapeHtml(goal.description) : "";
    const html = wrapEmailHtml(`
      <p style="font-size: 16px; line-height: 1.6; margin-bottom: 16px;">
        yo ${safeFirstName}
      </p>
      
      <p style="font-size: 16px; line-height: 1.6; margin-bottom: 16px;">
        welcome to alphamail. i'm alpha, your weekly accountability partner.
      </p>

      ${goal ? `
      <p style="font-size: 16px; line-height: 1.6; margin-bottom: 16px;">
        your first goal: <strong>${safeGoalDesc}</strong>
      </p>
      ` : ''}

      <p style="font-size: 16px; line-height: 1.6; margin-bottom: 16px;">
        here's how this works:
      </p>

      <p style="font-size: 16px; line-height: 1.6; margin-bottom: 16px;">
        every sunday i'll email you asking how your goal went. you reply with what happened — the good, the bad, whatever. then tell me your next goal. that's it.
      </p>

      <p style="font-size: 16px; line-height: 1.6; margin-bottom: 16px;">
        see you sunday.
      </p>

      <p style="font-size: 16px; color: #6b7280;">
        - alpha
      </p>
    `);

    const text = wrapEmailText(`yo ${profile.first_name}

welcome to alphamail. i'm alpha, your weekly accountability partner.

${goal ? `your first goal: ${goal.description}\n\n` : ''}here's how this works:

every sunday i'll email you asking how your goal went. you reply with what happened — the good, the bad, whatever. then tell me your next goal. that's it.

see you sunday.

- alpha`);

    await sendEmail({
      to: profile.email,
      subject: `yo ${profile.first_name}`,
      html,
      text,
    });

    // Log the email
    await supabase.from("emails").insert({
      user_id: userId,
      direction: "outbound",
      subject: `yo ${profile.first_name}`,
      content: text,
    });

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error: any) {
    console.error("Welcome email error:", error);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
};
