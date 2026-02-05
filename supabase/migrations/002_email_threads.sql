-- Add thread_id to emails for conversation threading
-- Run this in your Supabase SQL Editor

-- Add thread_id column (references first email in thread)
alter table public.emails 
add column if not exists thread_id uuid references public.emails(id);

-- Index for thread queries
create index if not exists idx_emails_thread_id on public.emails(thread_id);

-- Update existing emails: set thread_id to their own id (each becomes its own thread start)
update public.emails 
set thread_id = id 
where thread_id is null;
