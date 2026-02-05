import type { APIRoute } from "astro";
import { createServerClient } from "../../../lib/supabase";
import { sendEmail } from "../../../lib/resend";

// Sunday check-in email endpoint
// Call this via cron job every Sunday (e.g., Vercel Cron, GitHub Actions)
// POST /api/email/checkin
export const POST: APIRoute = async ({ request }) => {
  try {
    // Optional: Add a secret key check for security
    const authHeader = request.headers.get("authorization");
    const cronSecret = import.meta.env.CRON_SECRET;
    
    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    const supabase = createServerClient();

    // Get all users with active (incomplete) goals
    const { data: goals, error: goalsError } = await supabase
      .from("goals")
      .select(`
        id,
        user_id,
        description,
        due_date,
        profiles!inner (
          email,
          first_name,
          onboarded
        )
      `)
      .eq("completed", false)
      .eq("profiles.onboarded", true);

    if (goalsError) {
      console.error("Failed to fetch goals:", goalsError);
      return new Response(JSON.stringify({ error: goalsError.message }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (!goals || goals.length === 0) {
      return new Response(JSON.stringify({ message: "No active goals found", sent: 0 }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    let sent = 0;
    const errors: string[] = [];

    for (const goal of goals) {
      const profile = goal.profiles as any;
      const firstName = profile.first_name || "there";
      const email = profile.email;

      const html = `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 40px 20px; color: #1a1a1a;">
          <p style="font-size: 16px; line-height: 1.6; margin-bottom: 16px;">
            yo ${firstName}
          </p>
          
          <p style="font-size: 16px; line-height: 1.6; margin-bottom: 16px;">
            sunday check-in time. 👀
          </p>

          <p style="font-size: 16px; line-height: 1.6; margin-bottom: 16px;">
            your goal was: <strong>${goal.description}</strong>
          </p>

          <p style="font-size: 16px; line-height: 1.6; margin-bottom: 16px;">
            so... did you? be honest. i won't judge (much).
          </p>

          <p style="font-size: 16px; line-height: 1.6; margin-bottom: 16px;">
            hit reply and tell me what happened. the good, the bad, whatever. then give me your next goal.
          </p>

          <p style="font-size: 16px; color: #6b7280;">
            - alpha
          </p>
        </div>
      `;

      const text = `yo ${firstName}

sunday check-in time. 👀

your goal was: ${goal.description}

so... did you? be honest. i won't judge (much).

hit reply and tell me what happened. the good, the bad, whatever. then give me your next goal.

- alpha`;

      try {
        await sendEmail({
          to: email,
          subject: "sunday check-in",
          html,
          text,
        });

        // Log the email
        await supabase.from("emails").insert({
          user_id: goal.user_id,
          direction: "outbound",
          subject: "sunday check-in",
          content: text,
        });

        sent++;
      } catch (err: any) {
        console.error(`Failed to send to ${email}:`, err);
        errors.push(email);
      }
    }

    return new Response(JSON.stringify({ 
      message: `Sent ${sent} check-in emails`,
      sent,
      errors: errors.length > 0 ? errors : undefined,
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error: any) {
    console.error("Check-in email error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
};
