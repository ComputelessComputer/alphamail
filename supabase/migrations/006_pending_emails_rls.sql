-- Fix Supabase security advisor issues

-- 1. Enable RLS on pending_emails table
ALTER TABLE public.pending_emails ENABLE ROW LEVEL SECURITY;

-- 2. Fix function search_path for handle_new_user
ALTER FUNCTION public.handle_new_user() SET search_path = public;

-- 3. Fix function search_path for update_updated_at_column
ALTER FUNCTION public.update_updated_at_column() SET search_path = public;
