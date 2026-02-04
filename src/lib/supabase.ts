import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.PUBLIC_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error("Missing Supabase environment variables");
}

// Browser client (uses anon key, respects RLS)
export const supabase = createClient(supabaseUrl, supabaseAnonKey);

// Server client with service role (bypasses RLS - use only in API routes)
export function createServerClient() {
  const serviceRoleKey = import.meta.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey) {
    throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY");
  }
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

// Types for database tables
export interface Profile {
  id: string;
  user_id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  created_at: string;
  updated_at: string;
}

export interface Goal {
  id: string;
  user_id: string;
  description: string;
  due_date: string;
  completed: boolean;
  completed_at: string | null;
  created_at: string;
}

export interface Email {
  id: string;
  user_id: string;
  direction: "inbound" | "outbound";
  subject: string;
  content: string;
  summary: string | null;
  mood: string | null;
  created_at: string;
}
