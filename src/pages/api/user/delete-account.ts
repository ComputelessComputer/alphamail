import type { APIRoute } from "astro";
import { createServerClient } from "../../../lib/supabase";
import { 
  checkRateLimit, 
  getClientIP, 
  verifyCSRFToken, 
  auditLog 
} from "../../../lib/security";

// Delete user account and all associated data
export const POST: APIRoute = async ({ request, cookies }) => {
  try {
    // Rate limit: strict mode (10 requests/min)
    const clientIP = getClientIP(request);
    const rateLimitResult = await checkRateLimit(`delete-account:${clientIP}`, true);
    if (!rateLimitResult.success) {
      auditLog("api.rate_limited", request, {
        details: { endpoint: "delete-account", ip: clientIP },
      });
      return new Response(JSON.stringify({ error: "Too many requests" }), {
        status: 429,
        headers: { 
          "Content-Type": "application/json",
          "Retry-After": "60",
        },
      });
    }

    const { userId, csrfToken } = await request.json();

    if (!userId) {
      return new Response(JSON.stringify({ error: "Missing userId" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    // SECURITY: Verify the authenticated user matches the userId being deleted
    const authHeader = request.headers.get("authorization");
    const accessToken = authHeader?.replace("Bearer ", "") || 
                        cookies.get("sb-access-token")?.value;

    if (!accessToken) {
      auditLog("account.delete.attempt", request, {
        userId,
        details: { reason: "no_access_token" },
      });
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Verify the token and get the authenticated user
    const supabase = createServerClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser(accessToken);

    if (authError || !user || user.id !== userId) {
      auditLog("account.delete.attempt", request, {
        userId,
        details: { reason: "user_mismatch", actualUser: user?.id },
      });
      return new Response(JSON.stringify({ error: "Unauthorized - can only delete your own account" }), {
        status: 403,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Verify CSRF token (if provided)
    if (csrfToken && !verifyCSRFToken(csrfToken, user.id)) {
      auditLog("security.csrf_failure", request, {
        userId,
        details: { endpoint: "delete-account" },
      });
      return new Response(JSON.stringify({ error: "Invalid security token" }), {
        status: 403,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Delete in order due to foreign key constraints:
    // 1. emails
    // 2. goals  
    // 3. group_members (user's group memberships)
    // 4. profiles
    // 5. auth.users (handled by Supabase cascade)

    // Delete emails
    await supabase
      .from("emails")
      .delete()
      .eq("user_id", userId);

    // Delete goals
    await supabase
      .from("goals")
      .delete()
      .eq("user_id", userId);

    // Delete group memberships
    await supabase
      .from("group_members")
      .delete()
      .eq("user_id", userId);

    // Delete profile (this should cascade from auth.users, but explicit is safer)
    await supabase
      .from("profiles")
      .delete()
      .eq("user_id", userId);

    // Delete the auth user - this requires admin/service role
    const { error: deleteAuthError } = await supabase.auth.admin.deleteUser(userId);

    if (deleteAuthError) {
      console.error("Error deleting auth user:", deleteAuthError);
      // Even if auth deletion fails, data is already deleted
      return new Response(JSON.stringify({ 
        success: true, 
        warning: "Account data deleted, but auth cleanup may be incomplete" 
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Audit log the successful deletion
    auditLog("account.delete", request, {
      userId,
      email: user.email,
    });

    console.log(`Deleted account for user: ${userId}`);

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error: any) {
    console.error("Delete account error:", error);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
};
