-- Track email deliverability status
-- Used to skip users with bounced emails in check-in cron

alter table public.profiles 
add column if not exists email_status text default 'active' check (email_status in ('active', 'bounced', 'complained'));

alter table public.profiles 
add column if not exists email_status_updated_at timestamptz;

-- Index for filtering out bounced emails in cron
create index if not exists idx_profiles_email_status on public.profiles(email_status);

comment on column public.profiles.email_status is 'Email deliverability status: active, bounced, or complained';
