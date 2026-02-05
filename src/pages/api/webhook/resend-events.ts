import type { APIRoute } from "astro";
import { createServerClient } from "../../../lib/supabase";
import { verifyResendWebhook, auditLog } from "../../../lib/security";

// Resend webhook for email events (bounces, complaints, etc.)
// Configure this URL in Resend dashboard: https://resend.com/webhooks
// Events: email.bounced, email.complained
export const POST: APIRoute = async ({ request }) => {
  try {
    // Get raw body for signature verification
    const rawBody = await request.text();
    
    // Verify webhook signature
    const verification = await verifyResendWebhook(rawBody, request.headers);
    if (!verification.verified) {
      auditLog("webhook.invalid_signature", request, {
        details: { error: verification.error, endpoint: "resend-events" },
      });
      return new Response(JSON.stringify({ error: "Invalid webhook signature" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    const payload = verification.payload;
    const { type, data } = payload;

    const supabase = createServerClient();

    // Handle bounce events
    if (type === "email.bounced") {
      const email = data.to?.[0] || data.email;
      if (email) {
        console.log(`Email bounced for: ${email}`);
        
        await supabase
          .from("profiles")
          .update({ 
            email_status: "bounced",
            email_status_updated_at: new Date().toISOString(),
          })
          .eq("email", email);

        return new Response(JSON.stringify({ success: true, action: "marked_bounced" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
    }

    // Handle complaint events (user marked as spam)
    if (type === "email.complained") {
      const email = data.to?.[0] || data.email;
      if (email) {
        console.log(`Email complaint from: ${email}`);
        
        await supabase
          .from("profiles")
          .update({ 
            email_status: "complained",
            email_status_updated_at: new Date().toISOString(),
          })
          .eq("email", email);

        return new Response(JSON.stringify({ success: true, action: "marked_complained" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
    }

    // Handle delivery failures
    if (type === "email.delivery_delayed" || type === "email.failed") {
      const email = data.to?.[0] || data.email;
      console.log(`Email delivery issue for ${email}: ${type}`);
      // Don't mark as bounced for transient failures, just log
    }

    return new Response(JSON.stringify({ success: true, action: "ignored" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error: any) {
    console.error("Resend webhook error:", error);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
};
