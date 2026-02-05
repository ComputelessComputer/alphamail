import type { APIRoute } from "astro";
import { createServerClient } from "../../../lib/supabase";

// Delete user account and all associated data
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
    const { error: authError } = await supabase.auth.admin.deleteUser(userId);

    if (authError) {
      console.error("Error deleting auth user:", authError);
      // Even if auth deletion fails, data is already deleted
      return new Response(JSON.stringify({ 
        success: true, 
        warning: "Account data deleted, but auth cleanup may be incomplete" 
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    console.log(`Deleted account for user: ${userId}`);

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error: any) {
    console.error("Delete account error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
};
