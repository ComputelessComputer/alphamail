import type { APIRoute } from "astro";
import { createServerClient } from "../../../lib/supabase";
import { generateUserSummary, type EmailMessage } from "../../../lib/ai";

// Updates the AI-generated summary for a user
// Called after each conversation or on-demand from account page
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

    // Get profile
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

    // Get conversation history
    const { data: emails } = await supabase
      .from("emails")
      .select("direction, content, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: true })
      .limit(50);

    // Get goals
    const { data: goals } = await supabase
      .from("goals")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });

    const completedGoals = goals?.filter(g => g.completed).length || 0;
    const currentGoal = goals?.find(g => !g.completed);

    // Calculate weeks active
    const createdAt = new Date(profile.created_at);
    const now = new Date();
    const weeksActive = Math.max(1, Math.ceil((now.getTime() - createdAt.getTime()) / (7 * 24 * 60 * 60 * 1000)));

    // Generate new summary
    const summary = await generateUserSummary(
      profile.first_name || "there",
      (emails || []) as EmailMessage[],
      completedGoals,
      currentGoal?.description || null,
      weeksActive
    );

    // Update profile with new summary
    const { error: updateError } = await supabase
      .from("profiles")
      .update({ summary })
      .eq("user_id", userId);

    if (updateError) {
      console.error("Error updating summary:", updateError);
      return new Response(JSON.stringify({ error: updateError.message }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ success: true, summary }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error: any) {
    console.error("Update summary error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
};
