import type { APIRoute } from "astro";
import { createServerClient } from "../../../lib/supabase";
import { sendEmail, wrapEmailHtml, wrapEmailText, escapeHtml } from "../../../lib/resend";

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
    // Skip users with bounced or complained email status
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
          onboarded,
          email_status
        )
      `)
      .eq("completed", false)
      .eq("profiles.onboarded", true);

    if (goalsError) {
      console.error("Failed to fetch goals:", goalsError);
      return new Response(JSON.stringify({ error: "Failed to fetch goals" }), {
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
    let skipped = 0;
    const errors: string[] = [];

    for (const goal of goals) {
      const profile = goal.profiles as any;
      
      // Skip users with bounced or complained emails
      if (profile.email_status && profile.email_status !== "active") {
        console.log(`Skipping ${profile.email} - email status: ${profile.email_status}`);
        skipped++;
        continue;
      }
      
      const firstName = profile.first_name || "there";
      const email = profile.email;
      const safeFirstName = escapeHtml(firstName);
      const safeGoalDesc = escapeHtml(goal.description);

      const html = wrapEmailHtml(`
        <p style="font-size: 16px; line-height: 1.6; margin-bottom: 16px;">
          yo ${safeFirstName}
        </p>
        
        <p style="font-size: 16px; line-height: 1.6; margin-bottom: 16px;">
          sunday check-in time. 👀
        </p>

        <p style="font-size: 16px; line-height: 1.6; margin-bottom: 16px;">
          your goal was: <strong>${safeGoalDesc}</strong>
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
      `);

      const text = wrapEmailText(`yo ${firstName}

sunday check-in time. 👀

your goal was: ${goal.description}

so... did you? be honest. i won't judge (much).

hit reply and tell me what happened. the good, the bad, whatever. then give me your next goal.

- alpha`);

      try {
        await sendEmail({
          to: email,
          subject: "sunday check-in",
          html,
          text,
        });

        // Log the email and create new thread
        const { data: emailRecord } = await supabase.from("emails").insert({
          user_id: goal.user_id,
          direction: "outbound",
          subject: "sunday check-in",
          content: text,
        }).select("id").single();

        // Set thread_id to this email's id (starts new thread)
        if (emailRecord) {
          await supabase
            .from("emails")
            .update({ thread_id: emailRecord.id })
            .eq("id", emailRecord.id);
        }

        sent++;
      } catch (err: any) {
        console.error(`Failed to send to ${email}:`, err);
        errors.push(email);
      }
    }

    // Also send group check-ins
    let groupsSent = 0;
    const { data: groups } = await supabase
      .from("groups")
      .select(`
        id,
        group_members (
          user_id,
          profiles (
            email,
            first_name,
            email_status
          )
        ),
        group_goals (
          id,
          description,
          completed
        )
      `);

    if (groups && groups.length > 0) {
      for (const group of groups) {
        const members = group.group_members as any[] || [];
        const activeGoal = (group.group_goals as any[] || []).find((g: any) => !g.completed);
        
        if (!activeGoal || members.length < 2) continue;

        // Get active member emails
        const activeMembers = members.filter(
          m => m.profiles?.email_status !== "bounced" && m.profiles?.email_status !== "complained"
        );

        if (activeMembers.length < 2) continue;

        const memberNames = activeMembers.map(m => m.profiles?.first_name || "someone").join(" and ");
        const memberEmails = activeMembers.map(m => m.profiles?.email).filter(Boolean);
        const safeMemberNames = escapeHtml(memberNames);
        const safeGroupGoal = escapeHtml(activeGoal.description);

        const html = wrapEmailHtml(`
          <p style="font-size: 16px; line-height: 1.6; margin-bottom: 16px;">
            yo ${safeMemberNames}
          </p>
          
          <p style="font-size: 16px; line-height: 1.6; margin-bottom: 16px;">
            sunday group check-in time. 👀
          </p>

          <p style="font-size: 16px; line-height: 1.6; margin-bottom: 16px;">
            your group goal was: <strong>${safeGroupGoal}</strong>
          </p>

          <p style="font-size: 16px; line-height: 1.6; margin-bottom: 16px;">
            so... how'd you both do? reply-all so your partner can see, or reply just to me if you want to chat privately.
          </p>

          <p style="font-size: 16px; color: #6b7280;">
            - alpha
          </p>
        `);

        const text = wrapEmailText(`yo ${memberNames}

sunday group check-in time. 👀

your group goal was: ${activeGoal.description}

so... how'd you both do? reply-all so your partner can see, or reply just to me if you want to chat privately.

- alpha`);

        try {
          // Send to all members
          for (const email of memberEmails) {
            await sendEmail({
              to: email,
              subject: "sunday group check-in",
              html,
              text,
            });
          }
          groupsSent++;
        } catch (err: any) {
          console.error(`Failed to send group check-in:`, err);
        }
      }
    }

    return new Response(JSON.stringify({ 
      message: `Sent ${sent} individual + ${groupsSent} group check-in emails`,
      sent,
      groupsSent,
      skipped: skipped > 0 ? skipped : undefined,
      errors: errors.length > 0 ? errors : undefined,
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error: any) {
    console.error("Check-in email error:", error);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
};
