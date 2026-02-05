import type { APIRoute } from "astro";
import { createServerClient } from "../../../lib/supabase";

// Links pending emails from non-authenticated users to their new account
// Called after user completes signup/onboarding
export const POST: APIRoute = async ({ request }) => {
  try {
    const { userId, email } = await request.json();

    if (!userId || !email) {
      return new Response(JSON.stringify({ error: "Missing userId or email" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const supabase = createServerClient();

    // Find pending emails from this email address
    const { data: pendingEmails, error: fetchError } = await supabase
      .from("pending_emails")
      .select("*")
      .eq("email", email)
      .is("linked_user_id", null);

    if (fetchError) {
      console.error("Error fetching pending emails:", fetchError);
      return new Response(JSON.stringify({ error: fetchError.message }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (!pendingEmails || pendingEmails.length === 0) {
      return new Response(JSON.stringify({ 
        success: true, 
        message: "No pending emails to link",
        linked: 0,
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Link pending emails to user
    const { error: updateError } = await supabase
      .from("pending_emails")
      .update({ 
        linked_user_id: userId,
        linked_at: new Date().toISOString(),
      })
      .eq("email", email)
      .is("linked_user_id", null);

    if (updateError) {
      console.error("Error linking pending emails:", updateError);
      return new Response(JSON.stringify({ error: updateError.message }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Copy pending emails to the regular emails table with proper user_id
    // This preserves conversation history
    for (const pending of pendingEmails) {
      await supabase.from("emails").insert({
        user_id: userId,
        direction: "inbound",
        subject: pending.subject,
        content: pending.content,
        // Note: thread_id from pending_emails won't directly map, but content is preserved
      });
    }

    console.log(`Linked ${pendingEmails.length} pending emails for ${email}`);

    return new Response(JSON.stringify({ 
      success: true, 
      linked: pendingEmails.length,
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error: any) {
    console.error("Link pending emails error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
};
