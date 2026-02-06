import type { APIRoute } from "astro";

// Signup is now handled client-side via signInWithOtp (magic link).
// This endpoint is kept as a stub to avoid 404s from any lingering references.
export const POST: APIRoute = async () => {
  return new Response(JSON.stringify({ error: "Signup has moved to magic link flow. Use the /signup page directly." }), {
    status: 410,
    headers: { "Content-Type": "application/json" },
  });
};
