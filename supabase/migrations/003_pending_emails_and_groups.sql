-- Pending emails from non-authenticated users
-- These get linked to a user account after signup

create table if not exists public.pending_emails (
  id uuid primary key default gen_random_uuid(),
  email text not null,  -- sender's email address
  subject text not null,
  content text not null,
  thread_id uuid,  -- to maintain threading after signup
  linked_user_id uuid references auth.users(id) on delete set null,  -- set after signup
  linked_at timestamptz,  -- when it was linked to a user
  created_at timestamptz default now() not null
);

-- Index for finding pending emails by sender
create index if not exists idx_pending_emails_email on public.pending_emails(email);
create index if not exists idx_pending_emails_linked_user_id on public.pending_emails(linked_user_id);

-- No RLS needed - this table is only accessed by server/service role

-- Groups for accountability pairs/groups
create table if not exists public.groups (
  id uuid primary key default gen_random_uuid(),
  name text,  -- optional group name
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz default now() not null
);

-- Group members
create table if not exists public.group_members (
  id uuid primary key default gen_random_uuid(),
  group_id uuid references public.groups(id) on delete cascade not null,
  user_id uuid references auth.users(id) on delete cascade not null,
  joined_at timestamptz default now() not null,
  unique(group_id, user_id)
);

-- Group goals (shared goals for a group)
create table if not exists public.group_goals (
  id uuid primary key default gen_random_uuid(),
  group_id uuid references public.groups(id) on delete cascade not null,
  description text not null,
  due_date date not null,
  completed boolean default false,
  completed_at timestamptz,
  created_at timestamptz default now() not null
);

-- Indexes for groups
create index if not exists idx_group_members_group_id on public.group_members(group_id);
create index if not exists idx_group_members_user_id on public.group_members(user_id);
create index if not exists idx_group_goals_group_id on public.group_goals(group_id);

-- RLS for groups
alter table public.groups enable row level security;
alter table public.group_members enable row level security;
alter table public.group_goals enable row level security;

-- Users can view groups they're members of
create policy "Users can view their groups"
  on public.groups for select
  using (
    id in (
      select group_id from public.group_members where user_id = auth.uid()
    )
  );

-- Users can view members of their groups
create policy "Users can view group members"
  on public.group_members for select
  using (
    group_id in (
      select group_id from public.group_members where user_id = auth.uid()
    )
  );

-- Users can view goals of their groups
create policy "Users can view group goals"
  on public.group_goals for select
  using (
    group_id in (
      select group_id from public.group_members where user_id = auth.uid()
    )
  );

-- Users can insert goals for their groups
create policy "Users can insert group goals"
  on public.group_goals for insert
  with check (
    group_id in (
      select group_id from public.group_members where user_id = auth.uid()
    )
  );

-- Users can update goals in their groups
create policy "Users can update group goals"
  on public.group_goals for update
  using (
    group_id in (
      select group_id from public.group_members where user_id = auth.uid()
    )
  );
