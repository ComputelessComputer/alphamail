import type { APIRoute } from "astro";
import { createServerClient } from "../../../lib/supabase";
import { parseOnboardingReply } from "../../../lib/ai";
import { sendEmail, wrapEmailHtml, wrapEmailText, escapeHtml } from "../../../lib/resend";

export const POST: APIRoute = async ({ request }) => {
  try {
    const { email, message } = await request.json();

    if (!email || !message) {
      return new Response(JSON.stringify({ error: "Missing email or message" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Parse name + goal from free-form text
    const parsed = await parseOnboardingReply(message);

    if (!parsed.parsed) {
      return new Response(JSON.stringify({
        error: "parse_failed",
        clarification: parsed.clarificationMessage || "couldn't quite get your name and goal from that. mind trying again?",
      }), {
        status: 422,
        headers: { "Content-Type": "application/json" },
      });
    }

    const supabase = createServerClient();

    // Create user
    let userId: string | undefined;

    const { data: authData, error: authError } = await supabase.auth.admin.createUser({
      email,
      password: crypto.randomUUID(),
      email_confirm: true,
    });

    if (authError) {
      // If user already exists, look them up
      if (authError.message.includes("already") || authError.message.includes("exists")) {
        const { data: { users } } = await supabase.auth.admin.listUsers();
        const existingUser = users?.find(u => u.email === email);
        if (existingUser) {
          userId = existingUser.id;
        }
      }

      if (!userId) {
        console.error("Auth error:", authError.message, authError);
        return new Response(JSON.stringify({ error: "Could not create account. Please try again." }), {
          status: 500,
          headers: { "Content-Type": "application/json" },
        });
      }
    } else {
      userId = authData?.user?.id;
    }

    if (!userId) {
      return new Response(JSON.stringify({ error: "Could not create account. Please try again." }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Update profile
    await supabase.from("profiles").update({
      first_name: parsed.name,
      onboarded: true,
    }).eq("user_id", userId);

    // Create goal
    const nextSunday = new Date();
    nextSunday.setDate(nextSunday.getDate() + (7 - nextSunday.getDay()));
    await supabase.from("goals").insert({
      user_id: userId,
      description: parsed.goal,
      due_date: nextSunday.toISOString().split("T")[0],
    });

    // Send welcome email
    const safeName = escapeHtml(parsed.name);
    const safeGoal = escapeHtml(parsed.goal);
    const html = wrapEmailHtml(`
      <p style="font-size: 16px; line-height: 1.6; margin-bottom: 16px;">
        yo ${safeName}
      </p>
      <p style="font-size: 16px; line-height: 1.6; margin-bottom: 16px;">
        welcome to alphamail. i'm alpha, your weekly accountability partner.
      </p>
      <p style="font-size: 16px; line-height: 1.6; margin-bottom: 16px;">
        your first goal: <strong>${safeGoal}</strong>
      </p>
      <p style="font-size: 16px; line-height: 1.6; margin-bottom: 16px;">
        here's how this works:
      </p>
      <p style="font-size: 16px; line-height: 1.6; margin-bottom: 16px;">
        every sunday i'll email you asking how your goal went. you reply with what happened - the good, the bad, whatever. then tell me your next goal. that's it.
      </p>
      <p style="font-size: 16px; line-height: 1.6; margin-bottom: 16px;">
        see you sunday.
      </p>
      <p style="font-size: 16px; color: #6b7280;">
        - alpha
      </p>
    `);

    const text = wrapEmailText(`yo ${parsed.name}

welcome to alphamail. i'm alpha, your weekly accountability partner.

your first goal: ${parsed.goal}

here's how this works:

every sunday i'll email you asking how your goal went. you reply with what happened - the good, the bad, whatever. then tell me your next goal. that's it.

see you sunday.

- alpha`);

    await sendEmail({
      to: email,
      subject: `yo ${parsed.name}`,
      html,
      text,
    });

    // Log the email
    await supabase.from("emails").insert({
      user_id: userId,
      direction: "outbound",
      subject: `yo ${parsed.name}`,
      content: text,
    });

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error: any) {
    console.error("Signup error:", error);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
};
